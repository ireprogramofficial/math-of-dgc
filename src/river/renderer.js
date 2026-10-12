// WebGL2 renderer for the river: water/land/colormap background + animated flow streaks.
//
// Field texture (RGBA16F, linear filtered): r = u, g = v (m/s), b = signed distance to the bank (m, + in water).
//  * The background shader thresholds the *signed distance*, so shorelines stay crisp at any zoom.
//  * Each streak is an instanced triangle strip. A particle only supplies its head position; the vertex shader
//    rebuilds the curved tail by integrating the flow field backward in fixed *screen-pixel* steps, so streaks have
//    a consistent on-screen length at every zoom level and follow the flow's actual curvature.

import { colormapLUT } from './colormaps.js';

const TRAIL_STEPS = 14;

const BG_VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const BG_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uField;
uniform sampler2D uCmap;
uniform vec2 uWorld;
uniform vec2 uCenter;
uniform vec2 uRes;
uniform float uZoom;
uniform float uSpeedMax;
uniform float uGamma;
uniform float uCmapMix;
uniform vec3 uLand;
uniform vec3 uWater;
uniform vec3 uShore;
out vec4 outColor;
void main() {
  vec2 w = uCenter + (gl_FragCoord.xy - 0.5 * uRes) / uZoom;
  vec4 f = texture(uField, w / uWorld);
  bool inWorld = w.x >= 0.0 && w.y >= 0.0 && w.x <= uWorld.x && w.y <= uWorld.y;
  float inside = inWorld ? f.b : -1000.0;
  float px = 1.0 / uZoom;
  float cov = smoothstep(-0.75 * px, 0.75 * px, inside);
  float t = pow(clamp(length(f.rg) / uSpeedMax, 0.0, 1.0), uGamma);
  vec3 cm = texture(uCmap, vec2(t, 0.5)).rgb;
  vec3 water = mix(uWater, cm, uCmapMix);
  water *= 1.0 - 0.07 * exp(-max(inside, 0.0) / (5.0 + 25.0 * px));
  vec3 col = mix(uLand, water, cov);
  float edge = 1.0 - smoothstep(0.0, 1.5 * px, abs(inside));
  col = mix(col, uShore, 0.85 * edge * float(inWorld));
  outColor = vec4(col, 1.0);
}`;

const STREAK_VERT = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec3 aP;                // x, y (m), life phase
uniform sampler2D uField;
uniform vec2 uWorld;
uniform vec2 uCenter;
uniform vec2 uRes;
uniform float uZoom;       // device px per meter
uniform float uTrailPx;    // device px
uniform float uWidthPx;    // device px
uniform float uSpeedRef;
uniform float uAlpha;
uniform sampler2D uCmap;
uniform float uSpeedMax;
uniform float uGamma;
uniform float uCmapMix;
uniform vec3 uWater;
uniform vec3 uLight;
uniform vec3 uDark;
out float vAlpha;
out float vSide;
out vec3 vColor;
const int K = ${TRAIL_STEPS};

vec4 fld(vec2 p) { return texture(uField, p / uWorld); }

void main() {
  int k = gl_VertexID >> 1;
  float side = ((gl_VertexID & 1) == 0) ? -1.0 : 1.0;
  vec2 p = aP.xy;
  vec4 f0 = fld(p);
  float rel = clamp(length(f0.xy) / uSpeedRef, 0.0, 1.0);
  float ds = uTrailPx * (0.35 + 0.65 * rel) / uZoom / float(K);   // world step per trail segment
  bool alive = f0.b > 1.0;
  for (int i = 0; i < K; i++) {
    if (i >= k) break;
    vec4 f = fld(p);
    float s = length(f.xy);
    if (s < 1e-4) break;
    vec2 mid = p - 0.5 * ds * f.xy / s;           // midpoint step, backward along the flow
    vec4 fm = fld(mid);
    float sm = length(fm.xy);
    if (sm < 1e-4 || fm.b < 0.5) break;
    p -= ds * fm.xy / sm;
  }
  vec4 fk = fld(p);
  float sk = length(fk.xy);
  vec2 dir = sk > 1e-4 ? fk.xy / sk : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float tail = float(k) / float(K);
  float taper = 1.0 - 0.6 * tail;
  vec2 screen = (p - uCenter) * uZoom + nrm * side * 0.5 * uWidthPx * taper;
  gl_Position = vec4(screen / (0.5 * uRes), 0.0, 1.0);

  float ph = aP.z;
  float life = smoothstep(0.0, 0.12, ph) * (1.0 - smoothstep(0.8, 1.0, ph));
  // Pick ink or white from the luminance of the water color under the streak's head.
  float tt = pow(clamp(length(f0.xy) / uSpeedMax, 0.0, 1.0), uGamma);
  vec3 wc = mix(uWater, texture(uCmap, vec2(tt, 0.5)).rgb, uCmapMix);
  float dark = smoothstep(0.5, 0.68, dot(wc, vec3(0.299, 0.587, 0.114)));
  vColor = mix(uLight, uDark, dark);
  vAlpha = pow(1.0 - tail, 1.3) * life * (0.55 + 0.45 * rel) * uAlpha * mix(1.0, 0.7, dark) * (alive ? 1.0 : 0.0);
  vSide = side;
}`;

// Streamlines: fixed world-space line segments, drawn between the water and the streaks.
const LINE_VERT = `#version 300 es
in vec2 aPos;
uniform vec2 uCenter;
uniform vec2 uRes;
uniform float uZoom;
uniform vec2 uOffset; // device px, to fake line width (WebGL lines are 1 device px)
void main() { gl_Position = vec4(((aPos - uCenter) * uZoom + uOffset) / (0.5 * uRes), 0.0, 1.0); }`;

const LINE_FRAG = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = uColor; }`;

const STREAK_FRAG = `#version 300 es
precision mediump float;
in float vAlpha;
in float vSide;
in vec3 vColor;
out vec4 outColor;
void main() {
  float e = 1.0 - smoothstep(0.35, 1.0, abs(vSide));
  outColor = vec4(vColor, vAlpha * e);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('Shader compile failed: ' + gl.getShaderInfoLog(sh));
  return sh;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program link failed: ' + gl.getProgramInfoLog(p));
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); uniforms[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u: uniforms };
}

export const DEFAULT_STYLE = {
  land: [0.945, 0.925, 0.878],
  water: [0.78, 0.875, 0.945],
  shore: [0.54, 0.62, 0.7],
  streakLight: [1, 1, 1],
  streakDark: [0.12, 0.27, 0.48],
  streakAlpha: 0.9,
  trailPx: 52,
  widthPx: 1.9,
  cmapMix: 0.9,
  gamma: 0.65,
  speedMaxFactor: 1.4,
};

export class RiverRenderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.canvas = canvas;
    this.bg = program(gl, BG_VERT, BG_FRAG);
    this.streak = program(gl, STREAK_VERT, STREAK_FRAG);
    this.lines = program(gl, LINE_VERT, LINE_FRAG);
    this.lineVao = gl.createVertexArray();
    this.lineBuf = gl.createBuffer();
    this.lineCount = 0;
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    const lineLoc = gl.getAttribLocation(this.lines.p, 'aPos');
    gl.enableVertexAttribArray(lineLoc);
    gl.vertexAttribPointer(lineLoc, 2, gl.FLOAT, false, 8, 0);
    gl.bindVertexArray(null);
    this.emptyVao = gl.createVertexArray();

    this.streakVao = gl.createVertexArray();
    this.streakBuf = gl.createBuffer();
    gl.bindVertexArray(this.streakVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.streakBuf);
    const loc = gl.getAttribLocation(this.streak.p, 'aP');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 12, 0);
    gl.vertexAttribDivisor(loc, 1);
    gl.bindVertexArray(null);

    this.fieldTex = gl.createTexture();
    this.cmapTex = gl.createTexture();
    this.colormap = 'none';
    this.setColormap('none');
    this.flow = null;
    this._bufCap = 0;
  }

  setFlow(flow) {
    const gl = this.gl;
    this.flow = flow;
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, flow.nx, flow.ny, 0, gl.RGBA, gl.FLOAT, flow.toRGBA());
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) {
      gl.texParameteri(gl.TEXTURE_2D, k, v);
    }
  }

  /** Static streamlines as segment pairs [x0, y0, x1, y1, ...] in world meters (empty array to clear). */
  setStreamlines(segs) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, segs, gl.STATIC_DRAW);
    this.lineCount = segs.length / 2;
  }

  setColormap(name) {
    const gl = this.gl;
    this.colormap = name;
    gl.bindTexture(gl.TEXTURE_2D, this.cmapTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, colormapLUT(name));
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) {
      gl.texParameteri(gl.TEXTURE_2D, k, v);
    }
  }

  /**
   * @param {object} a { camera, k (layout px -> device px), particles: Float32Array, count, style }
   */
  render({ camera, k, particles, count, style }) {
    const gl = this.gl, flow = this.flow;
    if (!flow) return;
    const W = this.canvas.width, H = this.canvas.height;
    const st = { ...DEFAULT_STYLE, ...style };
    const zoom = camera.zoom * k;
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);

    // --- background
    gl.useProgram(this.bg.p);
    const u = this.bg.u;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.fieldTex); gl.uniform1i(u.uField, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.cmapTex); gl.uniform1i(u.uCmap, 1);
    gl.uniform2f(u.uWorld, flow.width, flow.height);
    gl.uniform2f(u.uCenter, camera.cx, camera.cy);
    gl.uniform2f(u.uRes, W, H);
    gl.uniform1f(u.uZoom, zoom);
    gl.uniform1f(u.uSpeedMax, flow.speedRef * st.speedMaxFactor);
    gl.uniform1f(u.uGamma, st.gamma);
    gl.uniform1f(u.uCmapMix, this.colormap === 'none' ? 0 : st.cmapMix);
    gl.uniform3fv(u.uLand, st.land);
    gl.uniform3fv(u.uWater, st.water);
    gl.uniform3fv(u.uShore, st.shore);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // --- static streamlines (the rails the streaks ride on)
    if (this.lineCount) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.lines.p);
      gl.uniform2f(this.lines.u.uCenter, camera.cx, camera.cy);
      gl.uniform2f(this.lines.u.uRes, W, H);
      gl.uniform1f(this.lines.u.uZoom, zoom);
      gl.uniform4fv(this.lines.u.uColor, this.colormap === 'none' ? [0.09, 0.16, 0.24, 0.2] : [1, 1, 1, 0.26]);
      gl.bindVertexArray(this.lineVao);
      // ~1.3 layout px wide on any display: overlapping 1-device-px passes
      const w = Math.max(1, Math.round(1.3 * k));
      for (let i = 0; i < w; i++) {
        const o = i - (w - 1) / 2;
        gl.uniform2f(this.lines.u.uOffset, o * 0.7, o * 0.7);
        gl.drawArrays(gl.LINES, 0, this.lineCount);
      }
      gl.disable(gl.BLEND);
    }

    // --- streaks
    if (count > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.streak.p);
      const s = this.streak.u;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.fieldTex); gl.uniform1i(s.uField, 0);
      gl.uniform2f(s.uWorld, flow.width, flow.height);
      gl.uniform2f(s.uCenter, camera.cx, camera.cy);
      gl.uniform2f(s.uRes, W, H);
      gl.uniform1f(s.uZoom, zoom);
      gl.uniform1f(s.uTrailPx, st.trailPx * k);
      gl.uniform1f(s.uWidthPx, st.widthPx * k);
      gl.uniform1f(s.uSpeedRef, flow.speedRef);
      gl.uniform1f(s.uAlpha, st.streakAlpha);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.cmapTex); gl.uniform1i(s.uCmap, 1);
      gl.uniform1f(s.uSpeedMax, flow.speedRef * st.speedMaxFactor);
      gl.uniform1f(s.uGamma, st.gamma);
      gl.uniform1f(s.uCmapMix, this.colormap === 'none' ? 0 : st.cmapMix);
      gl.uniform3fv(s.uWater, st.water);
      gl.uniform3fv(s.uLight, st.streakLight);
      gl.uniform3fv(s.uDark, st.streakDark);
      gl.bindVertexArray(this.streakVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.streakBuf);
      const bytes = count * 12;
      if (bytes > this._bufCap) { gl.bufferData(gl.ARRAY_BUFFER, particles.byteLength, gl.DYNAMIC_DRAW); this._bufCap = particles.byteLength; }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, particles, 0, count * 3);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 2 * (TRAIL_STEPS + 1), count);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteTexture(this.fieldTex); gl.deleteTexture(this.cmapTex); gl.deleteBuffer(this.streakBuf);
    gl.deleteProgram(this.bg.p); gl.deleteProgram(this.streak.p);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
