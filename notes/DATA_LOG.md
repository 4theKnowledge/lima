# Data Log

Append-only record of every data fetch. Format per row:

```
<ISO date> | <source> | <dataset> | <lga> | <feature_count> | <numberMatched> | <notes>
```

If `feature_count != numberMatched` the fetch is a failure — investigate before proceeding.

For manual downloads (SLIP portal), record: date | source | dataset code | scope | filename | size.

---

2026-09-04 | SLIP | LGATE-001 | statewide | Cadastre_No_Attributes_LGATE_001_WA_GDA2020_Public_Geopackage.zip | 333 MB zip / ~848 MB gpkg | manual browser download, GDA2020 variant
2026-09-04 | SLIP | LGATE-233 | statewide | LGA_Boundaries_LGATE_233_WA_GDA2020_Public_Geopackage.zip | 4 MB zip / ~5.6 MB gpkg | manual browser download, GDA2020 variant
2026-09-04 | LGATE-001 | cadastre | BOYUP BROOK, SHIRE OF | 5711 parcels intersecting | 5711 written | area_sum=443811ha
2026-09-04 | h3 | grid | BOYUP BROOK, SHIRE OF | resolution=7 | 661 cells | 689 with parcels | 5711 parcels aggregated
2026-09-04 | h3 | grid | BOYUP BROOK, SHIRE OF | resolution=7 | 751 cells | 689 with parcels | 5711 parcels aggregated
2026-09-04 | LGATE-001 | cadastre | MANJIMUP, SHIRE OF | 15855 parcels intersecting | 15855 written | area_sum=1477905ha
2026-09-04 | LGATE-001 | cadastre | BRIDGETOWN-GREENBUSHES, SHIRE OF | 8110 parcels intersecting | 8110 written | area_sum=228911ha
2026-09-04 | LGATE-001 | cadastre | DONNYBROOK-BALINGUP, SHIRE OF | 8560 parcels intersecting | 8560 written | area_sum=256332ha
2026-09-04 | LGATE-001 | cadastre | NANNUP, SHIRE OF | 4145 parcels intersecting | 4145 written | area_sum=552087ha
2026-09-04 | h3 | grid | NANNUP, SHIRE OF | resolution=7 | 799 cells | 430 with parcels | 4145 parcels aggregated
2026-09-04 | h3 | grid | MANJIMUP, SHIRE OF | resolution=7 | 1852 cells | 978 with parcels | 15855 parcels aggregated
2026-09-04 | h3 | grid | BRIDGETOWN-GREENBUSHES, SHIRE OF | resolution=7 | 280 cells | 334 with parcels | 8110 parcels aggregated
2026-09-04 | h3 | grid | DONNYBROOK-BALINGUP, SHIRE OF | resolution=7 | 349 cells | 365 with parcels | 8560 parcels aggregated
2026-09-04 | DWER-034 | groundwater | statewide | 45 areas | 584 cells proclaimed / 3447 unproclaimed
2026-09-04 | DWER-026 | salinity | statewide | 169 polygons | 3750 cells in polygon / 281 outside
2026-09-04 | DWER-026 | salinity | statewide | 169 polygons | 3750 cells in polygon / 281 outside
2026-09-04 | OBRM-024 | bushfire | statewide | 469 BPA polygons | 3799/4031 cells with overlap
2026-09-04 | DWER-037 | surface_water | statewide | 54 features | 1464 cells proclaimed / 2567 unproclaimed
2026-09-04 | SLIP | LGATE-248 | statewide | Townsites_LGATE_248_WA_GDA2020_Public_Geopackage.zip | 2 MB | manual download
2026-09-04 | SLIP | DBCA-011 | statewide | Legislated_Lands_and_Waters_DBCA_011_WA_GDA2020_Public_Geopackage.zip | 33 MB | manual download
2026-09-04 | SLIP | LGATE-195 | statewide | Roads_Simplified_LGATE_195_WA_GDA2020_Public_Geopackage.zip | 132 MB | manual download
2026-09-04 | SLIP | OBRM-024 | statewide | Bush_Fire_Prone_Areas_2025_OBRM_024_WA_GDA2020_Public_Geopackage.zip | ~1 MB | manual download
2026-09-04 | SLIP | DWER-037 | statewide | RIWI_Act_Surface_Water_Areas_and_Irrigation_Districts_DWER_037_WA_GDA2020_Public_Geopackage.zip | 1.2 MB | manual download
2026-09-04 | SLIP | DPIRD-027 | statewide | Best_Available_DPIRD_027_WA_GDA2020_Public_Geopackage.zip | 310 MB | manual download
2026-09-04 | DPIRD-027 | soils | statewide | 147,040 polygons | 3801/4031 cells with soil overlap
2026-09-04 | LGATE-248 | townsites | statewide | 636 polygons | nearest distance computed for 4031 cells
2026-09-04 | DBCA-011 | dbca | statewide | 13,482 polygons | 3165/4031 cells with DBCA overlap
2026-09-04 | LGATE-195 | roads | AOI-clipped | 13,189 sealed segments | distance computed for 4031 cells
2026-09-04 | SILO | rainfall | AOI | monthly_rain 1970-2024 | 3888/4031 cells with baseline, 3888 with trend
2026-09-04 | SILO S3 | monthly_rain | statewide | 55 NetCDFs (1970-2024) | 724 MB total | automated download via ingest/rainfall_download.py
2026-09-04 | LGATE-001 | cadastre | AUGUSTA MARGARET RIVER, SHIRE OF | 18918 parcels intersecting | 18918 written | area_sum=431862ha
2026-09-04 | h3 | grid | AUGUSTA MARGARET RIVER, SHIRE OF | resolution=7 | 670 cells | 438 with parcels | 18918 parcels aggregated
2026-09-04 | LGATE-001 | cadastre | KOJONUP, SHIRE OF | 6424 parcels intersecting | 6424 written | area_sum=325959ha
2026-09-04 | h3 | grid | KOJONUP, SHIRE OF | resolution=7 | 723 cells | 773 with parcels | 6424 parcels aggregated
2026-09-04 | LGATE-001 | cadastre | WEST ARTHUR, SHIRE OF | 5492 parcels intersecting | 5492 written | area_sum=381225ha
2026-09-04 | h3 | grid | WEST ARTHUR, SHIRE OF | resolution=7 | 697 cells | 728 with parcels | 5492 parcels aggregated
2026-09-04 | LGATE-001 | cadastre | BUSSELTON, CITY OF | 40171 parcels intersecting | 40171 written | area_sum=349580ha
2026-09-04 | h3 | grid | BUSSELTON, CITY OF | resolution=7 | 449 cells | 346 with parcels | 40171 parcels aggregated
2026-09-04 | LGATE-001 | cadastre | DENMARK, SHIRE OF | 8091 parcels intersecting | 8091 written | area_sum=582095ha
2026-09-04 | h3 | grid | DENMARK, SHIRE OF | resolution=7 | 521 cells | 285 with parcels | 8091 parcels aggregated
2026-09-04 | LGATE-001 | cadastre | PLANTAGENET, SHIRE OF | 9878 parcels intersecting | 9878 written | area_sum=1006897ha
2026-09-04 | h3 | grid | PLANTAGENET, SHIRE OF | resolution=7 | 1194 cells | 901 with parcels | 9878 parcels aggregated
2026-09-04 | LGATE-001 | cadastre | HARVEY, SHIRE OF | 22329 parcels intersecting | 22329 written | area_sum=295995ha
2026-09-04 | h3 | grid | HARVEY, SHIRE OF | resolution=7 | 454 cells | 351 with parcels | 22329 parcels aggregated
2026-09-04 | LGATE-001 | cadastre | COLLIE, SHIRE OF | 8350 parcels intersecting | 8350 written | area_sum=365410ha
2026-09-04 | h3 | grid | COLLIE, SHIRE OF | resolution=7 | 394 cells | 276 with parcels | 8350 parcels aggregated
2026-09-04 | LGATE-001 | cadastre | CRANBROOK, SHIRE OF | 5060 parcels intersecting | 5060 written | area_sum=842504ha
2026-09-04 | h3 | grid | CRANBROOK, SHIRE OF | resolution=7 | 718 cells | 761 with parcels | 5060 parcels aggregated
2026-09-04 | LGATE-001 | cadastre | MUNDARING, SHIRE OF | 23363 parcels intersecting | 23363 written | area_sum=207862ha
2026-09-04 | h3 | grid | MUNDARING, SHIRE OF | resolution=7 | 196 cells | 158 with parcels | 23363 parcels aggregated
2026-09-04 | LGATE-001 | cadastre | YORK, SHIRE OF | 6516 parcels intersecting | 6516 written | area_sum=404939ha
2026-09-04 | h3 | grid | YORK, SHIRE OF | resolution=7 | 586 cells | 478 with parcels | 6516 parcels aggregated
2026-09-04 | LGATE-001 | cadastre | NORTHAM, SHIRE OF | 12880 parcels intersecting | 12880 written | area_sum=203442ha
2026-09-04 | h3 | grid | NORTHAM, SHIRE OF | resolution=7 | 369 cells | 431 with parcels | 12880 parcels aggregated
2026-09-04 | DWER-034 | groundwater | statewide | 45 areas | 1701 cells proclaimed / 9301 unproclaimed
2026-09-04 | DWER-026 | salinity | statewide | 169 polygons | 10315 cells in polygon / 687 outside
2026-09-04 | DWER-037 | surface_water | statewide | 54 features | 4153 cells proclaimed / 6849 unproclaimed
2026-09-05 | OBRM-024 | bushfire | statewide | 469 BPA polygons | 10461/11002 cells with overlap
2026-09-05 | DPIRD-027 | soils | statewide | 147,040 polygons | 10460/11002 cells with soil overlap
2026-09-05 | LGATE-248 | townsites | statewide | 636 polygons | nearest distance computed for 11002 cells
2026-09-05 | DBCA-011 | dbca | statewide | 13,482 polygons | 6403/11002 cells with DBCA overlap
2026-09-05 | LGATE-195 | roads | AOI-clipped | 104,812 sealed segments | distance computed for 11002 cells
2026-09-05 | SILO | rainfall | AOI | monthly_rain 1970-2024 | 10646/11002 cells with baseline, 10646 with trend
2026-09-05 | OBRM-024 | bushfire | statewide | 469 BPA polygons | 10461/11002 cells with overlap
2026-09-05 | DPIRD-027 | soils | statewide | 147,040 polygons | 10460/11002 cells with soil overlap
2026-09-05 | LGATE-248 | townsites | statewide | 636 polygons | nearest distance computed for 11002 cells
2026-09-05 | DBCA-011 | dbca | statewide | 13,482 polygons | 6403/11002 cells with DBCA overlap
2026-09-05 | LGATE-195 | roads | AOI-clipped | 104,812 sealed segments | distance computed for 11002 cells
2026-09-05 | SILO | rainfall | AOI | monthly_rain 1970-2024 | 10646/11002 cells with baseline, 10646 with trend
