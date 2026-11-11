import { describe, test, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Profile from './Profile';

// vi.mock factories are hoisted above these declarations, so the fns live in
// vi.hoisted scope where the factory can reach them
const mocks = vi.hoisted(() => {
  const upload = vi.fn();
  const getPublicUrl = vi.fn();
  // the update chain is .update(...).eq(...) — mock the builder shape
  const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
  // the mount fetch is .select('avatar_url').eq(...).single() — same idea
  const single = vi.fn();
  const select = vi.fn(() => ({ eq: vi.fn(() => ({ single })) }));
  const from = vi.fn();
  return { upload, getPublicUrl, update, select, single, from };
});

vi.mock('../lib/auth', () => ({
  useAuth: () => ({
    player: { id: 'pid-1', name: 'tester' },
    token: 'tok-1',
    isGuest: false,
    signin: vi.fn(), register: vi.fn(), guestSignin: vi.fn(), signout: vi.fn(),
  }),
}));

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    storage: {
      from: () => ({ upload: mocks.upload, getPublicUrl: mocks.getPublicUrl }),
    },
    from: mocks.from,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upload.mockResolvedValue({ error: null });
  mocks.getPublicUrl.mockReturnValue({ data: { publicUrl: 'https://cdn.example/av.jpg' } });
  // Profile reads the persisted avatar on mount; default: no avatar on the row
  mocks.single.mockResolvedValue({ data: { avatar_url: null } });
  mocks.from.mockReturnValue({ update: mocks.update, select: mocks.select });
});

// 1x1 JPEG (red pixel) — createImageBitmap can decode it in jsdom? jsdom
// lacks createImageBitmap; mock it along with canvas 2d context.
function mockImagePipeline() {
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({
    width: 100, height: 100, close: () => {},
  }));
  const ctx = { drawImage: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) =>
    cb(new Blob(['jpeg-bytes'], { type: 'image/jpeg' })));
}

const file = () => new File([new Uint8Array([1, 2, 3])], 'me.png', { type: 'image/png' });

describe('Profile (avatar upload)', () => {
  test('downscales, uploads to the player folder, and persists avatar_url', async () => {
    mockImagePipeline();
    render(<MemoryRouter><Profile /></MemoryRouter>);
    fireEvent.change(screen.getByTestId('avatar-input'), { target: { files: [file()] } });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/saved/i));
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    const [path] = mocks.upload.mock.calls[0];
    expect(path).toMatch(/^pid-1\//); // per-player folder = storage RLS requirement
    expect(mocks.getPublicUrl).toHaveBeenCalledWith(path);
    expect(mocks.update).toHaveBeenCalledWith({ avatar_url: 'https://cdn.example/av.jpg' });
    expect(screen.getByAltText('avatar preview')).toHaveAttribute('src', 'https://cdn.example/av.jpg');
  });

  test('shows an error when the upload fails', async () => {
    mockImagePipeline();
    // supabase storage errors are Error instances (StorageError)
    mocks.upload.mockResolvedValue({ error: new Error('row-level security') });
    render(<MemoryRouter><Profile /></MemoryRouter>);
    fireEvent.change(screen.getByTestId('avatar-input'), { target: { files: [file()] } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/row-level security/);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  test('shows the player name as a prominent heading', () => {
    // note: a test body whose ONLY statement is this render expression trips a
    // vite:oxc .tsx parse bug (">()" misread as a generic call) — keep another
    // statement in the body, or brace the render call
    render(<MemoryRouter><Profile /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'tester' })).toBeInTheDocument();
  });

  test('shows the player flag derived from the id', () => {
    render(<MemoryRouter><Profile /></MemoryRouter>);
    expect(screen.getByTestId('player-flag')).toBeInTheDocument();
  });

  test('shows the persisted avatar image when the player row has one', async () => {
    mocks.single.mockResolvedValue({ data: { avatar_url: 'https://cdn.example/existing.jpg' } });
    render(<MemoryRouter><Profile /></MemoryRouter>);
    expect(await screen.findByAltText('your avatar')).toHaveAttribute('src', 'https://cdn.example/existing.jpg');
    expect(screen.queryByTestId('player-flag')).not.toBeInTheDocument();
  });

  test('uploads GIFs untouched (no downscale) so they keep animating', async () => {
    // no createImageBitmap/canvas mocks: the GIF path must not touch them
    const gif = new File([new Uint8Array([1, 2, 3])], 'me.gif', { type: 'image/gif' });
    render(<MemoryRouter><Profile /></MemoryRouter>);
    fireEvent.change(screen.getByTestId('avatar-input'), { target: { files: [gif] } });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/saved/i));
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    const [path, blob, opts] = mocks.upload.mock.calls[0];
    expect(path).toMatch(/^pid-1\/\d+\.gif$/);
    expect(blob).toBe(gif); // original bytes, not a canvas re-encode
    expect(opts).toEqual({ contentType: 'image/gif', upsert: false });
  });

  test('rejects GIFs over the 2 MB cap', async () => {
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.gif', { type: 'image/gif' });
    render(<MemoryRouter><Profile /></MemoryRouter>);
    fireEvent.change(screen.getByTestId('avatar-input'), { target: { files: [big] } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/under 2 MB/i);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
