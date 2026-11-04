import { CircleHelp, X } from "lucide-react";

export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  if (!message) return null;
  return (
    <div className="toast" role="status">
      <CircleHelp size={16} />
      {message}
      <button onClick={onClose} aria-label="关闭提示">
        <X size={14} />
      </button>
    </div>
  );
}
