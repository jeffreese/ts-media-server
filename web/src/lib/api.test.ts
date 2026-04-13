import { describe, it, expect } from 'vitest'
import { api } from '~/lib/api'

describe('api', () => {
  it('generates image URLs', () => {
    expect(api.imageUrl(1)).toBe('/image/1')
    expect(api.imageUrl(1, 300)).toBe('/image/1?width=300')
  })

  it('generates video URLs', () => {
    expect(api.videoUrl(42)).toBe('/video/42')
  })

  it('generates face URLs', () => {
    expect(api.faceUrl(7)).toBe('/face/7')
  })
})
