# Offline render harness (dev only)

Runs the real PIDS script in **Rhino 1.9.1** with a JCM API mock and real Java AWT
offscreen rendering. It is not needed to use the resource pack.

## Requirements

- Java 21+
- `rhino-1.9.1.jar` at `../rhino/rhino-1.9.1.jar` (relative to the pack root)
- Fonts in `harness/fonts/` (not committed):
  - `NotoSans-SemiBold.ttf` — Noto Sans SemiBold (SIL OFL 1.1)
  - `noto-sans-cjk-tc-medium.otf` — Noto Sans CJK TC Medium (SIL OFL 1.1)

## Run

```bash
JAVA=java ./harness/run.sh                 # all scenarios
JAVA=java ./harness/run.sh 'harness/scenarios/map_*.json'
python validate.py                          # static checks + render every scenario + pixel assertions
```

Outputs go to `harness/out/<scenario>.png`. A non-zero exit / `FAIL <scenario>` line means
the script threw in Rhino; fix it before testing in game.

Scenarios live in `harness/scenarios/*.json` and are plain data (size, arrivals, routes,
clock/weather, `SCRIPT_INPUT` overrides such as `view`/`phaseSec`).
