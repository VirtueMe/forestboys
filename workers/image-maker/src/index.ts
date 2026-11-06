/**
 * milorg-image-maker: the one worker with the Cloudflare Images binding (#410). The Pages project cannot have that binding,
 * so its functions call this worker through the service binding `IMAGE_MAKER`. The handler is in
 * functions/_lib/image-maker-handler.ts, where it is type-checked and tested.
 */
import { handleImageMaker, type ImagesApi } from '../../../functions/_lib/image-maker-handler.ts'

interface Env {
  IMAGES: ImagesApi
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handleImageMaker(request, env.IMAGES),
}
