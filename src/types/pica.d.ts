declare module "pica" {
  interface PicaInstance {
    resize(from: CanvasImageSource, to: CanvasImageSource, options?: Record<string, unknown>): Promise<void>;
  }

  export default function picaFactory(): PicaInstance;
}
