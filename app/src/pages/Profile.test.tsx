import { describe, test, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Profile from './Profile';

const upload = vi.fn();
const getPublicUrl = vi.fn();
// the component chains .update(...).eq(...) — mock the builder shape
const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
const from = vi.fn();

vi.mock('../lib/auth', () => ({
  useAuth: () => ({
    player: { id: 'pid-1', name: 'tester' },
    token: 'tok-1',
    isGuest: false,
    signin: vi.fn(), register: vi.fn(), guestSignin: vi.fn(), signout: vi.fn(),
  }),
}));

vi.mock('../lib/supabaseClient', () => ({
  getStorageClient: () => ({
    storage: {
      from: () => ({ upload, getPublicUrl }),
    },
    from,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  upload.mockResolvedValue({ error: null });
  getPublicUrl.mockReturnValue({ data: { publicUrl: 'https://cdn.example/av.jpg' } });
  from.mockReturnValue({ update });
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
    expect(upload).toHaveBeenCalledTimes(1);
    const [path] = upload.mock.calls[0];
    expect(path).toMatch(/^pid-1\//); // per-player folder = storage RLS requirement
    expect(getPublicUrl).toHaveBeenCalledWith(path);
    expect(update).toHaveBeenCalledWith({ avatar_url: 'https://cdn.example/av.jpg' });
    expect(screen.getByAltText('avatar preview')).toHaveAttribute('src', 'https://cdn.example/av.jpg');
  });

  test('shows an error when the upload fails', async () => {
    mockImagePipeline();
    // supabase storage errors are Error instances (StorageError)
    upload.mockResolvedValue({ error: new Error('row-level security') });
    render(<MemoryRouter><Profile /></MemoryRouter>);
    fireEvent.change(screen.getByTestId('avatar-input'), { target: { files: [file()] } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/row-level security/);
    expect(update).not.toHaveBeenCalled();
  });
});
