declare module '@knight-lab/timelinejs' {
  interface TimelineOptions {
    language?:          string
    timenav_position?:  string
    initial_zoom?:      number
    start_at_slide?:    number
    [key: string]:      unknown
  }

  interface TimelineChangeEvent {
    unique_id: string
  }

  class Timeline {
    constructor(id: string, data: unknown, options?: TimelineOptions)
    on(event: 'ready',  cb: () => void): void
    on(event: 'change', cb: (e: TimelineChangeEvent) => void): void
    goToId(id: string): void
  }

  export { Timeline }
}
