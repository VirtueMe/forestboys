import { describe, expect, it } from 'vitest'
import { tidyText } from './tidyText'

describe('tidyText', () => {
  it('trims leading and trailing whitespace', () => {
    expect(tidyText(' 42-7612')).toBe('42-7612')
  })

  it('collapses runs of spaces, tabs and line breaks', () => {
    expect(tidyText('Ford Liberator  B-24L-5\t44-49362\n9A-P')).toBe('Ford Liberator B-24L-5 44-49362 9A-P')
  })

  it('returns null for empty, blank and missing input', () => {
    expect(tidyText('')).toBeNull()
    expect(tidyText('   ')).toBeNull()
    expect(tidyText(null)).toBeNull()
    expect(tidyText(undefined)).toBeNull()
  })
})
