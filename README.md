# The math of DGC

An interactive slide deck (Reveal.js + WebGL) that builds intuition for the mathematics behind DGC:
dynamical systems, control-affine dynamics, open-loop trajectory optimization, and (planned) DGC's
linear time-varying discrete-time formulation. One running example carries the whole deck: **planning an
open-loop thrust schedule for a boat on a river.**

Everything runs in the browser. There is no backend, so it deploys as a static site on GitHub Pages.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173  (hot reload)
npm test           # flow solver + boat dynamics + optimizer tests
npm run build      # static site into dist/
npm run preview    # serve dist/ at http://localhost:4173
```

Needs Node 22 or newer.

## Navigating the deck

Arrow keys or on-screen arrows move between slides. `Esc` shows the slide overview, `F` goes fullscreen, `?` lists the
rest. On the map slides: **drag** to pan, **scroll** to zoom, **double-click** to reset the view.

## What is in it

| Slide | Widget | What it shows |
|---|---|---|
| 1 | `hero` | Title over a slowly drifting view of the branching delta |
| 2 | `gallery` | Six synthetic rivers, from a straight channel to a delta with five terminal basins. Pick a speed colormap (including none) and scripted camera moves |
| 3 | `schedule` | The components of an open-loop control-affine system, played out on the boat. Paint a thrust schedule, switch thrusters off, press play |
| 4 | `optimize` | The open-loop trajectory optimization problem, solved live. Drag the target, disable thrusters, watch the plan change |

### The model

```
state    x = (px, py, vx, vy)
input    u = (uN, uE, uS, uW) in [0,1]^4          four thrusters, none can pull backward
dynamics x' = f(x) + G u                           control-affine
         f(x) = ( v , -c (v - w(p)) )              the river drags the boat toward the local water velocity w(p)
         G    = [ 0 ; a E ]                         constant; E maps thrusters to (east, north) acceleration
```

The schedule is piecewise constant over 60 intervals. Each interval is integrated with RK4 sub-steps, and the
integrator also carries the sensitivities `A_j = dx_{j+1}/dx_j` and `B_j = dx_{j+1}/du`: the discrete-time
linear-time-varying system linearized about a trajectory. That is the bridge to DGC's LTV formulation.

The optimizer minimizes terminal miss + effort + a soft bank penalty with accelerated projected gradient
(FISTA, backtracking, adaptive restart), using an exact adjoint gradient. It converges in 0.1 to 1 s in the browser.

### The flow engine (`src/river/`)

* **Rivers** (`scenarios.js`, `geometry.js`): water regions built from signed-distance shapes, plus where water enters and leaves.
* **Flow** (`solver.js`): potential flow (Laplace's equation, solved coarse-to-fine by red-black SOR, in a Web Worker). Flux is conserved, so water speeds up in
  narrow channels and slows in basins. The gyre is an analytic vortex.
* **Streaks** (`renderer.js`, `particles.js`): particles live in *screen* space, so density and on-screen speed stay constant at every zoom.
  The GPU rebuilds each streak's curved tail by integrating the flow backward in fixed pixel steps, so streaks follow the flow's curvature and stay
  readable from 1.6 km down to 50 m. Shorelines are drawn from a signed-distance texture, so they stay crisp at any zoom.
* **Colormaps** (`colormaps.js`): `none`, rainbow (like the reference), viridis, plasma, turbo, blues.

## Adding to the deck

* **A slide**: add a `<section>` to `index.html`. Equations are KaTeX: `\( inline \)` and `$$ display $$`.
* **A widget**: create `src/widgets/<name>.js` exporting `create(el)` that returns `{ setActive(on), destroy() }`, register it in
  `src/widgets/index.js`, and put `<div data-widget="<name>"></div>` in a slide. Widgets are created lazily and only animate while their slide is visible.
* **A river**: add an entry to `src/river/scenarios.js`.
* On slides with interactive maps, add `data-prevent-swipe` to the `<section>` so dragging on touch screens pans the map instead of changing slides.

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` builds the site and publishes it on every push to `main`. In the repository, set
**Settings → Pages → Build and deployment → Source: GitHub Actions** once.

> **GitHub Pages sites are publicly readable**, even when the repository is private (private Pages access control needs GitHub Enterprise Cloud).
> Keep proprietary algorithm details out of anything you publish, or host the built `dist/` folder somewhere access-controlled.

## Reference material

`example-river-flow/` holds screenshots of a third party's video, used only as a visual reference for the flow style. It is git-ignored and must not
be committed or published.
