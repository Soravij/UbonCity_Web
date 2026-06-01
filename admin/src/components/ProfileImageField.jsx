import { useCallback, useEffect, useRef, useState } from "react";

function loadImageElementFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Failed to load image"));
      image.src = String(reader.result || "");
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function normalizeQuarterTurns(rotation) {
  const steps = Math.round(Number(rotation || 0) / 90);
  return ((steps % 4) + 4) % 4;
}

function canvasToBase64(canvas) {
  const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
  return String(dataUrl.split(",")[1] || "");
}

export default function ProfileImageField({
  valueKey = "",
  valuePreviewUrl = "",
  onChange,
  disabled = false,
  compact = false,
  altText = "Profile image",
}) {
  const inputRef = useRef(null);
  const canvasRef = useRef(null);
  const [status, setStatus] = useState("");
  const [cropOpen, setCropOpen] = useState(false);
  const [image, setImage] = useState(null);
  const [fileName, setFileName] = useState("");
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [centerX, setCenterX] = useState(0);
  const [centerY, setCenterY] = useState(0);
  const [dragState, setDragState] = useState({ active: false, x: 0, y: 0 });

  const closeCrop = useCallback(() => {
    setCropOpen(false);
    setImage(null);
    setFileName("");
    setZoom(1);
    setRotation(0);
    setCenterX(0);
    setCenterY(0);
    setDragState({ active: false, x: 0, y: 0 });
  }, []);

  const drawCropToCanvas = useCallback((canvas, targetSize = 320) => {
    if (!canvas || !image) return false;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;

    canvas.width = targetSize;
    canvas.height = targetSize;
    ctx.clearRect(0, 0, targetSize, targetSize);
    ctx.fillStyle = "#111827";
    ctx.fillRect(0, 0, targetSize, targetSize);

    const quarterTurns = normalizeQuarterTurns(rotation);
    const width = quarterTurns % 2 === 0 ? Number(image.width || 0) : Number(image.height || 0);
    const height = quarterTurns % 2 === 0 ? Number(image.height || 0) : Number(image.width || 0);
    if (!width || !height) return false;

    const scale = Math.max(targetSize / width, targetSize / height) * Math.max(1, Math.min(3, Number(zoom || 1)));
    const radians = (quarterTurns * Math.PI) / 2;

    ctx.save();
    ctx.translate(targetSize / 2, targetSize / 2);
    ctx.scale(scale, scale);
    ctx.rotate(radians);
    ctx.drawImage(image, -Number(centerX || image.width / 2), -Number(centerY || image.height / 2));
    ctx.restore();
    return true;
  }, [centerX, centerY, image, rotation, zoom]);

  useEffect(() => {
    if (!cropOpen) return;
    drawCropToCanvas(canvasRef.current, 320);
  }, [cropOpen, drawCropToCanvas]);

  async function onPickFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || disabled) return;
    try {
      setStatus("");
      const nextImage = await loadImageElementFromFile(file);
      setImage(nextImage);
      setFileName(String(file.name || "").trim() || "user-profile.jpg");
      setZoom(1);
      setRotation(0);
      setCenterX(Number(nextImage.width || 0) / 2);
      setCenterY(Number(nextImage.height || 0) / 2);
      setCropOpen(true);
    } catch (error) {
      setStatus(error.message || "Failed to open image");
    }
  }

  function onPointerDown(event) {
    if (!image) return;
    setDragState({ active: true, x: Number(event.clientX || 0), y: Number(event.clientY || 0) });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    if (!dragState.active || !image) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const quarterTurns = normalizeQuarterTurns(rotation);
    const width = quarterTurns % 2 === 0 ? Number(image.width || 0) : Number(image.height || 0);
    const height = quarterTurns % 2 === 0 ? Number(image.height || 0) : Number(image.width || 0);
    const scale = Math.max(canvas.width / width, canvas.height / height) * Math.max(1, Math.min(3, Number(zoom || 1)));
    const radians = (quarterTurns * Math.PI) / 2;
    const dx = Number(event.clientX || 0) - dragState.x;
    const dy = Number(event.clientY || 0) - dragState.y;
    const deltaX = ((dx * Math.cos(radians)) + (dy * Math.sin(radians))) / scale;
    const deltaY = ((-dx * Math.sin(radians)) + (dy * Math.cos(radians))) / scale;
    setDragState({ active: true, x: Number(event.clientX || 0), y: Number(event.clientY || 0) });
    setCenterX((prev) => Number(prev || image.width / 2) - deltaX);
    setCenterY((prev) => Number(prev || image.height / 2) - deltaY);
  }

  function onPointerUp(event) {
    setDragState((prev) => ({ ...prev, active: false }));
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function onConfirmCrop() {
    if (!image) return;
    try {
      const exportCanvas = document.createElement("canvas");
      if (!drawCropToCanvas(exportCanvas, 512)) {
        throw new Error("Failed to build cropped image");
      }
      const dataBase64 = canvasToBase64(exportCanvas);
      const previewUrl = exportCanvas.toDataURL("image/jpeg", 0.9);
      onChange?.({
        valueKey: "draft",
        previewUrl,
        dataBase64,
        mimeType: "image/jpeg",
        dirty: true,
      });
      setStatus("Profile image prepared");
      closeCrop();
    } catch (error) {
      setStatus(error.message || "Avatar prepare failed");
    }
  }

  function onClear() {
    onChange?.({
      valueKey: "",
      previewUrl: "",
      dataBase64: "",
      mimeType: "",
      dirty: true,
    });
    setStatus("");
  }

  return (
    <>
      <div className={`profile-image-field${compact ? " compact" : ""}`}>
        {valuePreviewUrl ? (
          <img
            src={valuePreviewUrl}
            alt={altText}
            className={`users-avatar-preview${compact ? " users-avatar-preview-small" : ""}`}
          />
        ) : (
          <div className={`users-avatar-fallback${compact ? " users-avatar-preview-small" : ""}`}>?</div>
        )}
        <div className="profile-image-field-controls">
          <div className="users-media-actions">
            <button type="button" className="ghost" disabled={disabled} onClick={() => inputRef.current?.click()}>
              Upload & crop
            </button>
            <button type="button" className="ghost" disabled={disabled || !valueKey} onClick={onClear}>
              Clear image
            </button>
          </div>
          <div className="muted">
            {valueKey ? "Profile image ready" : "No profile image"}
          </div>
          {status ? <div className="status profile-image-status">{status}</div> : null}
        </div>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onPickFile} />
      </div>

      {cropOpen ? (
        <div className="modal-backdrop" onClick={closeCrop}>
          <div className="modal-card profile-crop-modal" onClick={(event) => event.stopPropagation()}>
            <div className="card-title-row">
              <h2>Crop Profile Image</h2>
              <button type="button" className="ghost" onClick={closeCrop}>
                Close
              </button>
            </div>
            <p className="muted">{fileName || "Preparing image..."}</p>
            <div className="profile-crop-canvas-wrap">
              <canvas
                ref={canvasRef}
                width="320"
                height="320"
                className="profile-crop-canvas"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />
            </div>
            <div className="profile-crop-toolbar">
              <button type="button" className="ghost" onClick={() => setRotation((prev) => prev - 90)}>
                Rotate left
              </button>
              <button type="button" className="ghost" onClick={() => setRotation((prev) => prev + 90)}>
                Rotate right
              </button>
              <label className="profile-crop-zoom">
                <span className="muted">Zoom</span>
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.1"
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value || 1))}
                />
              </label>
              <span className="muted">{Number(zoom || 1).toFixed(1)}x</span>
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={closeCrop}>
                Cancel
              </button>
              <button type="button" className="primary" onClick={onConfirmCrop}>
                Use cropped image
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
