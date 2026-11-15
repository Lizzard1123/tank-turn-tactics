interface ConfirmDialogProps {
  action: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({ action, onConfirm, onCancel }: ConfirmDialogProps) {
  if (!action) return null;
  return (
    <div className="confirm-overlay" data-testid="confirm-overlay" onClick={onCancel}>
      <div className="confirm-dialog" data-testid="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 data-testid="confirm-title">CONFIRM</h2>
        <p data-testid="confirm-message">{action}</p>
        <div className="confirm-actions">
          <button data-testid="confirm-yes" onClick={onConfirm}>Yes</button>
          <button data-testid="confirm-no" onClick={onCancel}>No</button>
        </div>
      </div>
    </div>
  );
}
