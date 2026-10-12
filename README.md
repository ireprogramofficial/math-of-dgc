# The math of DGC

An interactive slide deck (Reveal.js + WebGL) that builds intuition for the mathematics behind DGC:
dynamical systems, control-affine dynamics, open-loop trajectory optimization, and (planned) DGC's
linear time-varying discrete-time formulation. One running example carries the whole deck: **planning an
open-loop thrust schedule for a boat on a river.**

Everything runs in the browser. There is no backend, so it deploys as a static site on GitHub Pages.

## Two decks, one site

| Deck | Source | Live URL |
|---|---|---|
| The math of DGC (boat on a river) | `index.html`, `src/main.js`, `src/widgets/` | `https://ireprogramofficial.github.io/math-of-dgc/` |
| The linear algebra of DGC (in progress) | `linear-algebra/index.html`, `src/linear-algebra/` | `https://ireprogramofficial.github.io/math-of-dgc/linear-algebra/` |

Both are entries in `vite.config.js` (`build.rollupOptions.input`), so one build and one Pages deploy publish both. The linear-algebra deck
reuses `src/styles/deck.css` and adds its own `src/linear-algebra/styles/deck.css`; its widgets go in `src/linear-algebra/widgets/` and are
registered in `src/linear-algebra/widgets/index.js` (same `create(el)` contract as below). In dev it is at http://localhost:5173/linear-algebra/.

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
| 1 | `hero` | Title over a slowly drifting view of the two-basin fork with gyres |
| 2 | `gallery` | **Definition: a dynamical system** (state space, drift, trajectory) beside the river as a vector field. Defaults to the meandering channel |
| 3 | `control` | **Definition: a control system.** A boat steers itself between points (feedback autopilot, A* path plus pure pursuit) and pauses at each arrival. Hold **W A S D** or the on-screen pad to take over; after 7 s without input the autopilot resumes. No target or schedule is shown |
| 4 | `loops` | **Key distinction: closed- versus open-loop.** Two block diagrams, and two boats leaving together for one target: open loop follows a precomputed schedule, closed loop reacts to its state. A gust pushes both; only the closed-loop boat recovers. Repeats; *Gust* and *Restart* buttons on the map |
| 5 | `optimize` | **Definition: trajectory optimization** (state space, control space, objective, dynamics, constraints), solved live. Drag the target, disable thrusters, watch the plan change |
| 6 | `unknown` | **Key challenge: unknown drift?** The triangle river with the flow hidden: a time series of samples circling basin 2's gyre and a single sample in basin 1 (generated from the true flow, with a little jitter). *Reveal f* shows the hidden flow. Mirrors cell reprogramming: we only glimpse the natural dynamics |
| 7 | — | The DGC problem P(R) and the data it relies on |

Every interactive slide shares one control bar (`src/widgets/mapControls.js`): **River**, **Color** (blues by default; rainbow, viridis,
plasma, turbo, or none) and **Camera** (the river's scripted views, with *Overview* as home). Pan and zoom are always available on the map.

The eight rivers, simplest to most complex: straight channel, meandering channel, river into a lake, confluence, gyre, fork with gyres (one source basin,
two meandering channels, two terminal basins, a vortex in each basin), triangle of gyres (three basins at the corners of an equilateral
triangle, joined pairwise by wide channels, so travel between any two basins is direct), and a branching delta (one source basin, five terminal basins).

Definitions on slides 2 and 3 follow `example-river-flow/definitions-for-trajectory-optimization.pptx` (git-ignored, iReprogram-internal; only the two
textbook-generic definitions are used on the slides).

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

### The autopilot (`src/control/autopilot.js`)

Picks a destination far from the boat, plans a path over the free water with A* (preferring mid-channel), and follows it with pure pursuit that only aims at
points visible over open water (so it cannot cut corners across land). A velocity-tracking law `a = kv (v_des - v) + c (v - w)` turns that into thruster
fractions, so the boat also holds station against the current while it pauses. It detects stalls and re-plans. `LiveBoat` enforces the banks as hard
limits so manual steering cannot beach the boat.

### The flow engine (`src/river/`)

* **Rivers** (`scenarios.js`, `geometry.js`): water regions built from signed-distance shapes, plus where water enters and leaves.
* **Flow** (`solver.js`): potential flow (Laplace's equation, solved coarse-to-fine by red-black SOR, in a Web Worker). Flux is conserved, so water speeds up in
  narrow channels and slows in basins. Potential flow cannot rotate, so gyres are explicit vortices added on top (`swirls` in a scenario). The standalone gyre is an analytic vortex.
* **Streaks** (`renderer.js`, `particles.js`): particles live in *screen* space, so density and on-screen speed stay constant at every zoom.
  The GPU rebuilds each streak's curved tail by integrating the flow backward in fixed pixel steps, so streaks follow the flow's curvature and stay
  readable from 1.6 km down to 50 m. Shorelines are drawn from a signed-distance texture, so they stay crisp at any zoom.
* **Colormaps** (`colormaps.js`): blues (default), rainbow, viridis, plasma, turbo, none. Streaks switch between white and ink according to the water color under them.

## Adding to the deck

* **A slide**: add a `<section>` to `index.html`. Equations are KaTeX: `\( inline \)` and `$$ display $$`.
* **A widget**: create `src/widgets/<name>.js` exporting `create(el)` that returns `{ setActive(on), destroy() }`, register it in
  `src/widgets/index.js`, and put `<div data-widget="<name>"></div>` in a slide. Widgets are created lazily and only animate while their slide is visible.
* **A river**: add an entry to `src/river/scenarios.js`. Its first view is the shared *Overview*; give it `span`/`spanY` to frame its own content.
* On slides with interactive maps, add `data-prevent-swipe` to the `<section>` so dragging on touch screens pans the map instead of changing slides.

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` builds the site and publishes it on every push to `main`. In the repository, set
**Settings → Pages → Build and deployment → Source: GitHub Actions** once.

> **GitHub Pages sites are publicly readable**, even when the repository is private (private Pages access control needs GitHub Enterprise Cloud).
> Keep proprietary algorithm details out of anything you publish, or host the built `dist/` folder somewhere access-controlled.

## Reference material

`example-river-flow/` holds screenshots of a third party's video, used only as a visual reference for the flow style. It is git-ignored and must not
be committed or published.

`example-dgc-linear-algebra/` holds iReprogram-internal reference material for the linear-algebra deck (a DGC variable dump and a deck). It is
git-ignored and must not be committed or published.
