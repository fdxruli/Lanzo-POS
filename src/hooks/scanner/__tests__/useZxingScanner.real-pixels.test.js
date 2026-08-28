// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  BarcodeFormat,
  BrowserMultiFormatReader,
  ChecksumException,
  DecodeHintType,
  FormatException,
  NotFoundException,
} from '@zxing/library';
import {
  createBinaryBitmapFromCanvas,
  isRecoverableDecodeError,
} from '../useZxingScanner';

const EAN13_VALUE = '7501234567893';

const EAN13_L_CODES = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
];

const EAN13_G_CODES = [
  '0100111',
  '0110011',
  '0011011',
  '0100001',
  '0011101',
  '0111001',
  '0000101',
  '0010001',
  '0001001',
  '0010111',
];

const EAN13_R_CODES = EAN13_L_CODES.map((code) => (
  [...code].map((bit) => (bit === '0' ? '1' : '0')).join('')
));

const EAN13_PARITY = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
];

const ean13ToModules = (value) => {
  const firstDigit = Number(value[0]);
  let modules = '101';

  for (let index = 1; index <= 6; index += 1) {
    const codeSet = EAN13_PARITY[firstDigit][index - 1] === 'L'
      ? EAN13_L_CODES
      : EAN13_G_CODES;
    modules += codeSet[Number(value[index])];
  }

  modules += '01010';

  for (let index = 7; index < 13; index += 1) {
    modules += EAN13_R_CODES[Number(value[index])];
  }

  return `${modules}101`;
};

const createBarcodeCanvas = ({
  value = EAN13_VALUE,
  moduleScale = 3,
  quietZone = 15,
  height = 120,
} = {}) => {
  const modules = ean13ToModules(value);
  const width = modules.length * moduleScale + quietZone * 2;
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);

  for (let y = 0; y < height; y += 1) {
    for (let moduleIndex = 0; moduleIndex < modules.length; moduleIndex += 1) {
      if (modules[moduleIndex] !== '1') continue;

      for (let scaleIndex = 0; scaleIndex < moduleScale; scaleIndex += 1) {
        const x = quietZone + (moduleIndex * moduleScale) + scaleIndex;
        const pixelIndex = ((y * width) + x) * 4;
        data[pixelIndex] = 0;
        data[pixelIndex + 1] = 0;
        data[pixelIndex + 2] = 0;
        data[pixelIndex + 3] = 255;
      }
    }
  }

  return {
    width,
    height,
    quietZone,
    blackBarX: quietZone,
    blackBarY: Math.floor(height / 2),
    getContext: () => ({
      getImageData: () => ({ data }),
    }),
  };
};

const createBlankCanvas = ({ width = 315, height = 120 } = {}) => {
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);

  return {
    width,
    height,
    getContext: () => ({
      getImageData: () => ({ data }),
    }),
  };
};

const createReader = () => new BrowserMultiFormatReader(new Map([
  [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13]],
]));

describe('useZxingScanner real pixel decode path', () => {
  it('decodes the deterministic EAN-13 fixture through the production bitmap path', () => {
    const canvas = createBarcodeCanvas();
    const reader = createReader();
    const result = reader.decodeBitmap(createBinaryBitmapFromCanvas(canvas));

    expect(result.getText()).toBe(EAN13_VALUE);
  });

  it('keeps consecutive ROI and full normal bitmap polarity deterministic', () => {
    const roiCanvas = createBarcodeCanvas({ moduleScale: 3, quietZone: 15 });
    const fullCanvas = createBarcodeCanvas({ moduleScale: 2, quietZone: 24, height: 160 });
    const reader = createReader();
    const roiBitmap = createBinaryBitmapFromCanvas(roiCanvas);
    const fullBitmap = createBinaryBitmapFromCanvas(fullCanvas);

    expect(roiBitmap.getBlackMatrix().get(roiCanvas.blackBarX, roiCanvas.blackBarY)).toBe(true);
    expect(fullBitmap.getBlackMatrix().get(fullCanvas.blackBarX, fullCanvas.blackBarY)).toBe(true);
    expect(reader.decodeBitmap(roiBitmap).getText()).toBe(EAN13_VALUE);
    expect(reader.decodeBitmap(fullBitmap).getText()).toBe(EAN13_VALUE);
  });

  it('captures and classifies a real blank-frame NotFound as recoverable', () => {
    const reader = createReader();
    let thrownError;

    try {
      reader.decodeBitmap(createBinaryBitmapFromCanvas(createBlankCanvas()));
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(NotFoundException);
    expect(thrownError.getKind()).toBe(NotFoundException.kind);
    expect(isRecoverableDecodeError(thrownError)).toBe(true);
  });

  it.each([
    ['NotFoundException', NotFoundException, () => NotFoundException.getNotFoundInstance()],
    ['ChecksumException', ChecksumException, () => ChecksumException.getChecksumInstance()],
    ['FormatException', FormatException, () => FormatException.getFormatInstance()],
  ])('classifies a real %s without consulting constructor.name', (_label, ErrorType, createError) => {
    const error = createError();

    expect(error).toBeInstanceOf(ErrorType);
    expect(isRecoverableDecodeError(error)).toBe(true);
    expect(isRecoverableDecodeError({ name: error.name })).toBe(false);
  });

  it('does not classify an ordinary Error as recoverable', () => {
    expect(isRecoverableDecodeError(new Error('decoder broke'))).toBe(false);
  });
});
