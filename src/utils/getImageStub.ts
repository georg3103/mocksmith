/**
 * Generates a checkerboard placeholder image.
 * */
export const getImageStub = (
  width = 100,
  height = width,
  { squareSize = Math.ceil(width / 10), color1 = '#807d7d', color2 = '#f1efef' } = {}
) => {
  let svgContent = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;

  for (let y = 0; y < height; y += squareSize) {
    for (let x = 0; x < width; x += squareSize) {
      const isEvenSquare = (x / squareSize + y / squareSize) % 2 === 0;
      const color = isEvenSquare ? color1 : color2;

      svgContent += `<rect x="${x}" y="${y}" width="${squareSize}" height="${squareSize}" fill="${color}" />`;
    }
  }

  svgContent += '</svg>';

  return svgContent;
};

export function getImageStubUrl(...args: Parameters<typeof getImageStub>) {
  const svgContent = getImageStub(...args);

  return 'data:image/svg+xml,' + encodeURIComponent(svgContent);
}
