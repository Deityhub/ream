import { expect, test } from 'vitest'
import { formatColor, formatValue as f, general } from '../src/numfmt.ts'

test('general: trims, rounds to 10 digits, scientific for extremes', () => {
  expect([general(3), general(0.1 + 0.2), general(1234.5), general(1e21), general(-2.5e-7)]).toEqual(['3', '0.3', '1234.5', '1E+21', '-2.5E-07'])
})

test('numbers: places, grouping, percent, negatives, literals', () => {
  expect(f(1234.567, '0.00')).toBe('1234.57')
  expect(f(1234.567, '#,##0.00')).toBe('1,234.57')
  expect(f(1234567, '#,##0')).toBe('1,234,567')
  expect(f(0.256, '0%')).toBe('26%')
  expect(f(0.256, '0.0%')).toBe('25.6%')
  expect(f(5, '000')).toBe('005')
  expect(f(0.5, '#.##')).toBe('.5')
  expect(f(2, '#.##')).toBe('2')
  expect(f(-1234.5, '#,##0.00')).toBe('-1,234.50')
  expect(f(-1234.5, '#,##0.00;(#,##0.00)')).toBe('(1,234.50)')
  expect(f(1234.5, '"$"#,##0.00')).toBe('$1,234.50')
  expect(f(1234.5, '[$€-407]#,##0.00')).toBe('€1,234.50')
  expect(f(0, '0;-0;"nil"')).toBe('nil')
  expect(f(1500000, '0.0,,"M"')).toBe('1.5M')
  expect(f(12, '0 "kg"')).toBe('12 kg')
})

test('dates and times from serial numbers (1900 system)', () => {
  expect(f(45000, 'yyyy-mm-dd')).toBe('2023-03-15')
  expect(f(45000, 'm/d/yyyy')).toBe('3/15/2023')
  expect(f(45000, 'd mmm yy')).toBe('15 Mar 23')
  expect(f(45000, 'dddd, mmmm d')).toBe('Wednesday, March 15')
  expect(f(45000.75, 'h:mm AM/PM')).toBe('6:00 PM')
  expect(f(45000.5 + 30 / 86400, 'hh:mm:ss')).toBe('12:00:30')
  expect(f(45000.25, 'yyyy-mm-dd hh:mm')).toBe('2023-03-15 06:00')
  expect(f(1, 'm/d/yyyy')).toBe('1/1/1900')
  expect(f(61, 'm/d/yyyy')).toBe('3/1/1900')
})

test('text and other types', () => {
  expect(f('abc', 'General')).toBe('abc')
  expect(f('abc', '@')).toBe('abc')
  expect(f('abc', '0.00;0.00;0.00;"is "@')).toBe('is abc')
  expect(f(true, undefined)).toBe('TRUE')
  expect(f(null, '0.00')).toBe('')
  expect(f(42, 'General')).toBe('42')
})

test('colours in formats follow the section the value is shown with', () => {
  expect(formatColor(-3, '0;[Red]-0')).toBe('FF0000')
  expect(formatColor(3, '0;[Red]-0')).toBeUndefined()
  expect(formatColor(0, '[Blue]0;[Red]-0;[Green]0')).toBe('00FF00')
  expect(formatColor('x', '0;0;0;[Magenta]@')).toBe('FF00FF')
  expect(formatColor(-1, '#,##0;[$€-407][Red]-#,##0')).toBe('FF0000')
  expect(formatColor(1, '"[Red]"0')).toBeUndefined() // quoted text is not a colour
  expect(formatColor(5, undefined)).toBeUndefined()
})
