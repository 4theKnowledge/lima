# Sensitivity Log

Append-only log of `scoring/sensitivity.py` runs. Compare across dates to see whether the ranking got more or less stable as data or weights changed. Machine-readable JSON per run in `notes/sensitivity/`.

---

## 2026-09-04T22:42:50+08:00

- **Shift**: ±25%
- **Scored cells**: 1,567 across 5 LGAs
- **Baseline weights**: water=0.30, rainfall=0.25, soil=0.20, access=0.15, bushfire=0.10
- **Worst ρ (cells)**: 0.9828
- **Worst ρ (LGAs)**: 1.0000
- **Verdict**: STABLE — ranking is data-driven.

| Weight | Shift | ρ cells | ρ LGAs |
|---|---|---|---|
| water | -25% | 0.9828 | 1.0000 |
| water | +25% | 0.9949 | 1.0000 |
| rainfall | -25% | 0.9931 | 1.0000 |
| rainfall | +25% | 0.9885 | 1.0000 |
| soil | -25% | 0.9991 | 1.0000 |
| soil | +25% | 0.9992 | 1.0000 |
| access | -25% | 0.9998 | 1.0000 |
| access | +25% | 0.9998 | 1.0000 |
| bushfire | -25% | 0.9984 | 1.0000 |
| bushfire | +25% | 0.9987 | 1.0000 |

Baseline LGA ranking:

- 0.746 — BRIDGETOWN-GREENBUSHES, SHIRE OF
- 0.733 — DONNYBROOK-BALINGUP, SHIRE OF
- 0.705 — MANJIMUP, SHIRE OF
- 0.700 — NANNUP, SHIRE OF
- 0.666 — BOYUP BROOK, SHIRE OF

JSON: `notes/sensitivity/20260904T224250.json`

---

## 2026-09-05T06:01:00+08:00

- **Shift**: ±25%
- **Scored cells**: 3,815 across 17 LGAs
- **Baseline weights**: water=0.30, rainfall=0.25, soil=0.20, access=0.15, bushfire=0.10
- **Worst ρ (cells)**: 0.9798
- **Worst ρ (LGAs)**: 0.9755
- **Verdict**: STABLE — ranking is data-driven.

| Weight | Shift | ρ cells | ρ LGAs |
|---|---|---|---|
| water | -25% | 0.9798 | 0.9804 |
| water | +25% | 0.9908 | 0.9926 |
| rainfall | -25% | 0.9881 | 0.9755 |
| rainfall | +25% | 0.9875 | 0.9828 |
| soil | -25% | 0.9982 | 1.0000 |
| soil | +25% | 0.9983 | 0.9877 |
| access | -25% | 0.9998 | 0.9975 |
| access | +25% | 0.9998 | 0.9951 |
| bushfire | -25% | 0.9985 | 0.9975 |
| bushfire | +25% | 0.9987 | 0.9951 |

Baseline LGA ranking:

- 0.805 — DENMARK, SHIRE OF
- 0.746 — BRIDGETOWN-GREENBUSHES, SHIRE OF
- 0.733 — DONNYBROOK-BALINGUP, SHIRE OF
- 0.715 — PLANTAGENET, SHIRE OF
- 0.705 — MANJIMUP, SHIRE OF
- 0.700 — NANNUP, SHIRE OF
- 0.666 — BOYUP BROOK, SHIRE OF
- 0.661 — CRANBROOK, SHIRE OF
- 0.655 — HARVEY, SHIRE OF
- 0.609 — MUNDARING, SHIRE OF
- 0.604 — AUGUSTA MARGARET RIVER, SHIRE OF
- 0.604 — BUSSELTON, CITY OF
- 0.595 — COLLIE, SHIRE OF
- 0.594 — WEST ARTHUR, SHIRE OF
- 0.569 — KOJONUP, SHIRE OF
- 0.567 — NORTHAM, SHIRE OF
- 0.547 — YORK, SHIRE OF

JSON: `notes/sensitivity/20260905T060100.json`

---

## 2026-09-05T06:13:31+08:00

- **Shift**: ±25%
- **Scored cells**: 3,815 across 17 LGAs
- **Baseline weights**: water=0.30, rainfall=0.25, soil=0.20, access=0.15, bushfire=0.10
- **Worst ρ (cells)**: 0.9798
- **Worst ρ (LGAs)**: 0.9755
- **Verdict**: STABLE — ranking is data-driven.

| Weight | Shift | ρ cells | ρ LGAs |
|---|---|---|---|
| water | -25% | 0.9798 | 0.9804 |
| water | +25% | 0.9908 | 0.9926 |
| rainfall | -25% | 0.9881 | 0.9755 |
| rainfall | +25% | 0.9875 | 0.9828 |
| soil | -25% | 0.9982 | 1.0000 |
| soil | +25% | 0.9983 | 0.9877 |
| access | -25% | 0.9998 | 0.9975 |
| access | +25% | 0.9998 | 0.9951 |
| bushfire | -25% | 0.9985 | 0.9975 |
| bushfire | +25% | 0.9987 | 0.9951 |

Baseline LGA ranking:

- 0.805 — DENMARK, SHIRE OF
- 0.746 — BRIDGETOWN-GREENBUSHES, SHIRE OF
- 0.733 — DONNYBROOK-BALINGUP, SHIRE OF
- 0.715 — PLANTAGENET, SHIRE OF
- 0.705 — MANJIMUP, SHIRE OF
- 0.700 — NANNUP, SHIRE OF
- 0.666 — BOYUP BROOK, SHIRE OF
- 0.661 — CRANBROOK, SHIRE OF
- 0.655 — HARVEY, SHIRE OF
- 0.609 — MUNDARING, SHIRE OF
- 0.604 — AUGUSTA MARGARET RIVER, SHIRE OF
- 0.604 — BUSSELTON, CITY OF
- 0.595 — COLLIE, SHIRE OF
- 0.594 — WEST ARTHUR, SHIRE OF
- 0.569 — KOJONUP, SHIRE OF
- 0.567 — NORTHAM, SHIRE OF
- 0.547 — YORK, SHIRE OF

JSON: `notes/sensitivity/20260905T061331.json`

---

## 2026-09-05T22:07:54+08:00

- **Shift**: ±25%
- **Scored cells**: 1,991 across 15 LGAs
- **Baseline weights**: water=0.28, rainfall=0.25, soil=0.25, access=0.08, bushfire=0.04, scale=0.10
- **Worst ρ (cells)**: 0.9935
- **Worst ρ (LGAs)**: 0.9821
- **Verdict**: STABLE — ranking is data-driven.

| Weight | Shift | ρ cells | ρ LGAs |
|---|---|---|---|
| water | -25% | 0.9935 | 0.9929 |
| water | +25% | 0.9984 | 0.9893 |
| rainfall | -25% | 0.9965 | 0.9821 |
| rainfall | +25% | 0.9970 | 0.9929 |
| soil | -25% | 0.9991 | 0.9964 |
| soil | +25% | 0.9992 | 0.9964 |
| access | -25% | 0.9999 | 1.0000 |
| access | +25% | 0.9999 | 1.0000 |
| bushfire | -25% | 0.9997 | 0.9964 |
| bushfire | +25% | 0.9997 | 1.0000 |
| scale | -25% | 0.9966 | 0.9964 |
| scale | +25% | 0.9970 | 0.9821 |

Baseline LGA ranking:

- 0.786 — DENMARK, SHIRE OF
- 0.753 — PLANTAGENET, SHIRE OF
- 0.728 — BRIDGETOWN-GREENBUSHES, SHIRE OF
- 0.721 — BOYUP BROOK, SHIRE OF
- 0.701 — NANNUP, SHIRE OF
- 0.696 — DONNYBROOK-BALINGUP, SHIRE OF
- 0.687 — MANJIMUP, SHIRE OF
- 0.618 — WEST ARTHUR, SHIRE OF
- 0.613 — HARVEY, SHIRE OF
- 0.611 — MUNDARING, SHIRE OF
- 0.607 — NORTHAM, SHIRE OF
- 0.595 — COLLIE, SHIRE OF
- 0.595 — AUGUSTA MARGARET RIVER, SHIRE OF
- 0.587 — BUSSELTON, CITY OF
- 0.585 — YORK, SHIRE OF

JSON: `notes/sensitivity/20260905T220754.json`

---

