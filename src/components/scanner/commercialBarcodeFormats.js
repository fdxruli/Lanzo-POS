import './ScannerDesktopNotice.css';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

export const COMMERCIAL_BARCODE_FORMATS = Object.freeze([
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.ITF,
  BarcodeFormat.RSS_14,
]);

export const COMMERCIAL_BARCODE_SCAN_HINTS = new Map([
  [DecodeHintType.POSSIBLE_FORMATS, COMMERCIAL_BARCODE_FORMATS],
]);
