import { describe, it, expect } from 'vitest';
import { evaluateExpression, formatCalculatorResult } from '@/utils/calculator';

describe('Calculator Utilities', () => {
  describe('evaluateExpression', () => {
    it('simple addition', () => {
      expect(evaluateExpression('2+3')).toBe(5);
      expect(evaluateExpression('0.5+0.33')).toBeCloseTo(0.83, 5);
    });

    it('simple subtraction', () => {
      expect(evaluateExpression('5-3')).toBe(2);
      expect(evaluateExpression('10.5-3.2')).toBeCloseTo(7.3, 5);
    });

    it('simple multiplication', () => {
      expect(evaluateExpression('3*4')).toBe(12);
      expect(evaluateExpression('3*24')).toBe(72);
      expect(evaluateExpression('2.5*4')).toBe(10);
    });

    it('simple division', () => {
      expect(evaluateExpression('10/2')).toBe(5);
      expect(evaluateExpression('7/2')).toBe(3.5);
      expect(evaluateExpression('1/3')).toBeCloseTo(0.333333, 5);
    });

    it('complex expressions with operator precedence', () => {
      expect(evaluateExpression('3*24+7')).toBe(79);
      expect(evaluateExpression('3*24 + 7')).toBe(79);
      expect(evaluateExpression('2+3*4')).toBe(14);
      expect(evaluateExpression('10-2*3')).toBe(4);
    });

    it('expressions with parentheses', () => {
      expect(evaluateExpression('(2+3)*4')).toBe(20);
      expect(evaluateExpression('2*(3+4)')).toBe(14);
      expect(evaluateExpression('(10-2)*3')).toBe(24);
    });

    it('partial bottle calculations', () => {
      expect(evaluateExpression('0.5+0.33')).toBeCloseTo(0.83, 5);
      expect(evaluateExpression('1/2+1/3')).toBeCloseTo(0.833333, 5);
      expect(evaluateExpression('0.25+0.5+0.25')).toBe(1);
    });

    it('case calculations', () => {
      expect(evaluateExpression('3*24+7')).toBe(79); // 3 cases of 24 + 7 bottles
      expect(evaluateExpression('2*12+5')).toBe(29); // 2 cases of 12 + 5 bottles
    });

    it('handles whitespace', () => {
      expect(evaluateExpression('  2 + 3  ')).toBe(5);
      expect(evaluateExpression('3 * 24 + 7')).toBe(79);
    });

    it('negative numbers', () => {
      expect(evaluateExpression('-5+3')).toBe(-2);
      expect(evaluateExpression('10+-5')).toBe(5);
      expect(evaluateExpression('10-(-5)')).toBe(15);
    });

    it('decimal numbers', () => {
      expect(evaluateExpression('1.5+2.5')).toBe(4);
      expect(evaluateExpression('3.14*2')).toBeCloseTo(6.28, 5);
    });

    it('invalid expressions return null', () => {
      expect(evaluateExpression('')).toBeNull();
      expect(evaluateExpression('   ')).toBeNull();
      expect(evaluateExpression('abc')).toBeNull();
      expect(evaluateExpression('2++3')).toBeNull();
      expect(evaluateExpression('2..3')).toBeNull();
      expect(evaluateExpression('/2')).toBeNull();
      expect(evaluateExpression('2+')).toBeNull();
      expect(evaluateExpression('2+*3')).toBeNull();
    });

    it('division by zero returns null', () => {
      expect(evaluateExpression('10/0')).toBeNull();
      expect(evaluateExpression('5/(3-3)')).toBeNull();
    });

    it('mismatched parentheses return null', () => {
      expect(evaluateExpression('(2+3')).toBeNull();
      expect(evaluateExpression('2+3)')).toBeNull();
    });

    it('just a number', () => {
      expect(evaluateExpression('42')).toBe(42);
      expect(evaluateExpression('3.14')).toBe(3.14);
    });

    it('complex real-world scenarios', () => {
      // 2.5 cases of 24 + 10 bottles + half a bottle
      expect(evaluateExpression('2.5*24+10+0.5')).toBe(70.5);
      
      // (3 cases of 12 + 5) divided by 2
      expect(evaluateExpression('(3*12+5)/2')).toBe(20.5);
    });
  });

  describe('formatCalculatorResult', () => {
    it('removes trailing zeros', () => {
      expect(formatCalculatorResult(5.0)).toBe('5');
      expect(formatCalculatorResult(5.50)).toBe('5.5');
      expect(formatCalculatorResult(5.123000)).toBe('5.123');
    });

    it('keeps necessary decimals', () => {
      expect(formatCalculatorResult(5.5)).toBe('5.5');
      expect(formatCalculatorResult(3.14159)).toBe('3.14159');
    });

    it('handles integers', () => {
      expect(formatCalculatorResult(42)).toBe('42');
      expect(formatCalculatorResult(100)).toBe('100');
    });

    it('handles very small numbers', () => {
      expect(formatCalculatorResult(0.000001)).toBe('0.000001');
      expect(formatCalculatorResult(0.333333)).toBe('0.333333');
    });
  });
});
