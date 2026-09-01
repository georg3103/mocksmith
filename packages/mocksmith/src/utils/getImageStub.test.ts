import { getImageStubUrl } from './getImageStub';

describe('generateImageStub', () => {
  test('should generate a valid SVG data URL with default parameters', () => {
    const result = getImageStubUrl();

    expect(result).toMatch(/^data:image\/svg\+xml,/);
    expect(result).toContain('%3Csvg');
    expect(result).toContain('svg%3E');
  });

  test('should respect width and height parameters', () => {
    const width = 200;
    const height = 150;
    const result = getImageStubUrl(width, height);
    const decoded = decodeURIComponent(result);

    expect(decoded).toContain(`width="${width}"`);
    expect(decoded).toContain(`height="${height}"`);
  });

  test('should apply custom colors and square size', () => {
    const result = getImageStubUrl(100, 100, {
      squareSize: 20,
      color1: '#ff0000',
      color2: '#00ff00',
    });

    const decoded = decodeURIComponent(result);

    expect(decoded).toContain('fill="#ff0000"');
    expect(decoded).toContain('fill="#00ff00"');
  });

  test('should encode SVG correctly as data URL', () => {
    const result = getImageStubUrl(50, 50);
    const decoded = decodeURIComponent(
      result.replace('data:image/svg+xml,', '')
    );

    expect(decoded).toContain('<svg');
    expect(decoded).toContain('</svg>');
  });
});
