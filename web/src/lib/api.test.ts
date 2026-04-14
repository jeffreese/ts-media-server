import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiError, api } from '~/lib/api'

describe('api', () => {
  describe('URL builders', () => {
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

  describe('ApiError', () => {
    it('stores status and body', () => {
      const err = new ApiError(404, 'Not Found')
      expect(err).toBeInstanceOf(Error)
      expect(err.name).toBe('ApiError')
      expect(err.status).toBe(404)
      expect(err.body).toBe('Not Found')
      expect(err.message).toBe('API 404: Not Found')
    })
  })

  describe('request handling', () => {
    beforeEach(() => {
      vi.restoreAllMocks()
    })

    it('throws ApiError on non-ok responses', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('Not Found', { status: 404, statusText: 'Not Found' }),
      )

      await expect(api.mediaItem(999)).rejects.toThrow(ApiError)
      await expect(api.mediaItem(999)).rejects.toMatchObject({
        status: 404,
        body: 'Not Found',
      })
    })

    it('parses JSON responses', async () => {
      const mockItem = { id: 1, name: 'test', type: 'image' }
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(mockItem), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const result = await api.mediaItem(1)
      expect(result).toEqual(mockItem)
    })

    it('sends correct headers', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('{}', { status: 200 }),
      )

      await api.mediaItem(1)

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/mediaItem/1',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      )
    })

    it('builds query parameters for index endpoint', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ folders: [], items: [], offset: 0, limit: 20, total: 0, path: '', folderId: null }), { status: 200 }),
      )

      await api.index('photos', { offset: 10, limit: 20 })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/index/photos'),
        expect.anything(),
      )
      const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string
      expect(url).toContain('offset=10')
      expect(url).toContain('limit=20')
    })

    it('builds query parameters for search endpoint', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ items: [], offset: 0, limit: 60, total: 0 }), { status: 200 }),
      )

      await api.search({ q: 'sunset', type: 'image', offset: 0, limit: 60 })

      const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string
      expect(url).toContain('q=sunset')
      expect(url).toContain('type=image')
    })

    it('sends POST body for addKeyword', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ id: 1, word: 'nature', alreadyTagged: false }), { status: 200 }),
      )

      await api.addKeyword(5, 'nature')

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/mediaItem/5/keywords',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ word: 'nature' }),
        }),
      )
    })
  })
})
