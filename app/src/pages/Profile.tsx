import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabaseClient';

const MAX_DIM = 256; // downscale target: board circles are tiny; 256px is plenty

// /profile — upload a profile picture. It is downscaled client-side, pushed
// to the avatars storage bucket under the player's own folder (storage RLS
// checks auth.uid() against the folder name), and persisted on the players
// row via the players_update_own policy.
export default function Profile() {
  const { player, token } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function downscale(file: File): Promise<Blob> {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw new Error('could not process image');
    return blob;
  }

  async function handleFile(file: File) {
    if (!player || !token) return;
    setError(null);
    setDone(false);
    setBusy(true);
    try {
      const blob = await downscale(file);
      const path = `${player.id}/${Date.now()}.jpg`;
      // supabase-js attaches the GoTrue session token automatically, so
      // storage RLS resolves auth.uid() to the uploader
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      const { error: dbErr } = await supabase
        .from('players')
        .update({ avatar_url: data.publicUrl })
        .eq('id', player.id);
      if (dbErr) throw dbErr;
      setPreview(data.publicUrl);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page profile">
      <h1>Profile</h1>
      <p>{player?.name}</p>
      {/* the tank marker your opponents see on the board */}
      <button
        type="button"
        className="avatar-frame"
        onClick={() => fileInput.current?.click()}
        disabled={busy}
        aria-label={preview ? 'Change picture' : 'Upload picture'}
      >
        {preview
          ? <img src={preview} alt="avatar preview" width={96} height={96} className="avatar-preview" />
          : <span className="avatar-placeholder" aria-hidden>?</span>}
        <span className="avatar-frame-hint">{busy ? 'Uploading…' : 'Change picture'}</span>
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="visually-hidden"
        data-testid="avatar-input"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
      />
      {done && <p role="status">Picture saved.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <p><Link to="/dashboard">Back to dashboard</Link></p>
    </main>
  );
}
