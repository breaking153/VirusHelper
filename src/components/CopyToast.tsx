import { useEffect, useState } from 'react';

export function CopyToast() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 2200);
    return () => clearTimeout(timer);
  }, []);
  return visible ? (
    <div className="copy-toast">
      <span className="success-text" aria-hidden="true">
        ✓
      </span>
      已复制到剪贴板
    </div>
  ) : null;
}
