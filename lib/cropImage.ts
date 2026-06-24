/**
 * Produces a cropped image Blob from a source image URL and pixel-crop area
 * (as given by react-easy-crop's onCropComplete). Output is scaled to a fixed
 * size to cap upload dimensions.
 */
export async function getCroppedBlob(
  imageSrc: string,
  crop: { x: number; y: number; width: number; height: number },
  outputWidth = 600,
  outputHeight = 800, // 3:4
): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  // Draw the cropped region of the source, scaled to output size
  ctx.drawImage(
    image,
    crop.x, crop.y, crop.width, crop.height,  // source rectangle (the crop)
    0, 0, outputWidth, outputHeight,           // destination (full canvas)
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Crop failed"))),
      "image/jpeg",
      0.9, // quality
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", reject);
    img.src = src;
  });
}