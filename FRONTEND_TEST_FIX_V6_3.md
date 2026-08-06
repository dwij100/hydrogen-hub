# Frontend test fix v6.3

## Failure fixed

The Docker frontend build reached the Vitest suite and failed in
`src/components/wizard/StepResults.test.tsx` because the test searched for a
series-control button whose accessible name was `Hide storage_unit=BESS2`.

The visible button text is intentionally shortened to `BESS2`. The complete
label existed only in the HTML `title` tooltip, and `title` was not used as the
button's accessible name in this rendered test case.

## Production change

File changed:

`src/components/wizard/StepResults.tsx`

Added the following attribute to each series-control button:

```tsx
aria-label={`${isHidden ? 'Show' : 'Hide'} ${item.label}`}
```

The existing visible concise label and tooltip remain unchanged. The button is
now correctly discoverable by assistive technology and by the existing test.

## Scope

No plot calculations, chart data, solver code, constraints, objectives,
Gurobi settings, backend APIs, or model inputs were changed.
