/**
 * Thrown by the Arena constructor when the browser cannot create a WebGL
 * context. `ArenaView` catches exactly this class and shows the WebGL notice (Req 9.10).
 */
export class WebglUnavailableError extends Error {
  constructor(message = "WebGL is required to render the Arena but is not available.") {
    super(message);
    this.name = "WebglUnavailableError";
  }
}
