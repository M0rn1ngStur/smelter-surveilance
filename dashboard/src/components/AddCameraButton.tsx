interface AddCameraButtonProps {
  onClick: () => void;
}

export function AddCameraButton({ onClick }: AddCameraButtonProps) {
  return (
    <button
      onClick={onClick}
      className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-sentinel-border bg-transparent p-6 text-sm text-slate-400 transition hover:border-cyan-500/50 hover:text-cyan-400 md:w-72 md:min-h-[180px] md:flex-shrink-0"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-5 w-5"
      >
        <path d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" />
      </svg>
      Dodaj kamerę
    </button>
  );
}
