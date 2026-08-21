#!/usr/bin/env bash
# Downloads real EPW files used by the test suite. These are NOT shipped with the app.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/test/fixtures"
mkdir -p "$DIR"

fetch() {
  local name="$1" url="$2"
  if [ -s "$DIR/$name" ]; then echo "have  $name"; return; fi
  echo "fetch $name"
  curl -fsSL --retry 3 --retry-delay 2 -o "$DIR/$name" "$url"
}

fetch chicago_ohare_tmy3.epw \
  "https://raw.githubusercontent.com/NREL/EnergyPlus/develop/weather/USA_IL_Chicago-OHare.Intl.AP.725300_TMY3.epw"
fetch london_gatwick_iwec.epw \
  "https://energyplus-weather.s3.amazonaws.com/europe_wmo_region_6/GBR/GBR_London.Gatwick.037760_IWEC/GBR_London.Gatwick.037760_IWEC.epw"

ls -la "$DIR"
