import { useState, useEffect } from 'react';
import { listLocalVideos } from '../api/client';

interface AddCameraButtonProps {
  onAddCamera: () => void;
  onAddServerVideo: (filename: string) => void;
}

export function AddCameraButton({ onAddCamera, onAddServerVideo }: AddCameraButtonProps) {
  const [showServerPicker, setShowServerPicker] = useState(false);
  const [serverVideos, setServerVideos] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!showServerPicker) return;
    setLoading(true);
    listLocalVideos()
      .then(setServerVideos)
      .catch(() => setServerVideos([]))
      .finally(() => setLoading(false));
  }, [showServerPicker]);

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex w-full gap-2">
        <button
          onClick={onAddCamera}
          className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-sentinel-border bg-transparent p-6 text-sm text-slate-400 transition hover:border-cyan-500/50 hover:text-cyan-400 min-h-[120px]"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" />
          </svg>
          Camera
        </button>
        <button
          onClick={() => setShowServerPicker((v) => !v)}
          className={`flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-transparent p-6 text-sm transition min-h-[120px] ${
            showServerPicker
              ? 'border-purple-500/50 text-purple-400'
              : 'border-sentinel-border text-slate-400 hover:border-purple-500/50 hover:text-purple-400'
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path d="M3.25 4A2.25 2.25 0 001 6.25v7.5A2.25 2.25 0 003.25 16h7.5A2.25 2.25 0 0013 13.75v-7.5A2.25 2.25 0 0010.75 4h-7.5zM19 4.75a.75.75 0 00-1.28-.53l-3 3a.75.75 0 00-.22.53v4.5c0 .199.079.39.22.53l3 3a.75.75 0 001.28-.53V4.75z" />
          </svg>
          Video
        </button>
      </div>

      {showServerPicker && (
        <div className="rounded-xl border border-sentinel-border bg-sentinel-card p-3">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">
            Server Videos
          </h3>
          {loading ? (
            <p className="text-xs text-slate-500">Loading...</p>
          ) : serverVideos.length === 0 ? (
            <p className="text-xs text-slate-500">No videos in server/local_videos/</p>
          ) : (
            <div className="flex flex-col gap-1">
              {serverVideos.map((filename) => (
                <button
                  key={filename}
                  onClick={() => {
                    onAddServerVideo(filename);
                    setShowServerPicker(false);
                  }}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-300 transition hover:bg-white/5 hover:text-white"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4 shrink-0 text-purple-400">
                    <path d="M3 3a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2V5a2 2 0 00-2-2H3zm3.5 4.5a.5.5 0 01.8-.4l3 2.25a.5.5 0 010 .8l-3 2.25a.5.5 0 01-.8-.4v-4.5z" />
                  </svg>
                  <span className="truncate">{filename}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
