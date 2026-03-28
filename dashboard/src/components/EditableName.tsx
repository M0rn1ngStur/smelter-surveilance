import { useState, useRef, useEffect } from 'react';

interface EditableNameProps {
  name: string;
  placeholder: string;
  onRename: (name: string) => void;
}

export function EditableName({ name, placeholder, onRename }: EditableNameProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    onRename(trimmed);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setDraft(name);
            setEditing(false);
          }
        }}
        className="min-w-0 flex-1 truncate rounded border border-sentinel-border bg-transparent px-1.5 py-0.5 text-sm text-slate-200 outline-none focus:border-cyan-500/50"
        maxLength={32}
      />
    );
  }

  return (
    <button
      onClick={() => { setDraft(name); setEditing(true); }}
      className="min-w-0 truncate text-sm text-slate-300 hover:text-white"
      title="Click to rename"
    >
      {name || placeholder}
    </button>
  );
}
