#!/bin/bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DIR/audio" "$DIR/clips" "$DIR/output"

API_KEY="${OPENAI_API_KEY:?Set OPENAI_API_KEY}"

gen() {
  local name="$1"
  local text="$2"
  echo "  TTS: $name..."
  curl -s https://api.openai.com/v1/audio/speech \
    -H "Authorization: Bearer ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg input "$text" '{model:"tts-1-hd",voice:"nova",input:$input,response_format:"wav"}')" \
    -o "$DIR/audio/${name}.wav"
}

echo "=== Generating employee help voiceovers ==="

gen "welcome" \
  "Welcome to EasyShiftHQ! This is your home base. Use the tabs at the bottom to check your schedule, view your pay, clock in and out, and access more features like timecards, shift trades, and tips. Let's get started!"

gen "clock" \
  "To clock in, tap the Clock tab and hit Clock In. When it's time for a break, tap Start Break. When you're done, tap End Break. At the end of your shift, tap Clock Out. If your location is required, make sure to allow location access."

gen "schedule" \
  "Your schedule shows all your upcoming shifts. Swipe left or right to see different weeks. Each shift shows your start and end time, position, and break duration. Tap a shift to request a trade with a coworker."

gen "pay" \
  "The Pay tab shows your earnings for the current pay period. You can see your total hours, hourly rate, and estimated pay. Switch between pay periods using the arrows at the top."

gen "timecard" \
  "Your timecard shows every clock in and clock out for the current period. Check it regularly to make sure your hours are accurate. If something looks wrong, talk to your manager."

gen "tips" \
  "The Tips section shows your tip history. You can see how tips were split, your share, and the total pool. If you think there's an error, you can submit a dispute."

gen "shifts" \
  "The Shift Marketplace lets you pick up available shifts. Browse open shifts posted by coworkers or your manager. Tap a shift to request it — your manager will approve or deny the trade."

gen "requests" \
  "Use Requests to manage your time off and availability. Set your recurring weekly availability so your manager knows when you can work. You can also submit one-time time off requests for specific dates."

echo ""
echo "=== Audio generation complete ==="
for f in "$DIR/audio"/*.wav; do
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" 2>/dev/null)
  printf "  %-20s %.1fs\n" "$(basename "$f")" "$dur"
done

echo ""
echo "Next steps:"
echo "  1. Record screen clips with Playwright (record-employee-help.cjs)"
echo "  2. Composite videos with compose-employee-help.sh"
echo "  3. Upload to Supabase Storage: help-videos/"
