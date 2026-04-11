#!/bin/bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
CLIPS="$DIR/clips"
AUDIO="$DIR/audio"
OUT="$DIR/output"
BG_MUSIC="$DIR/../audio/bg-music.wav"

SEGMENTS=(welcome clock schedule pay timecard tips shifts requests)

mkdir -p "$OUT"

# Generate bg music if it doesn't exist
if [ ! -f "$BG_MUSIC" ]; then
  echo "Generating background music..."
  ffmpeg -y \
    -f lavfi -i "sine=frequency=261.63:duration=30:sample_rate=44100" \
    -f lavfi -i "sine=frequency=329.63:duration=30:sample_rate=44100" \
    -f lavfi -i "sine=frequency=392.00:duration=30:sample_rate=44100" \
    -filter_complex "[0]volume=0.03[c];[1]volume=0.02[e];[2]volume=0.02[g];[c][e][g]amix=inputs=3:duration=longest[mixed];[mixed]lowpass=f=2000,afade=t=in:st=0:d=2,afade=t=out:st=27:d=3[out]" \
    -map "[out]" "$BG_MUSIC" 2>/dev/null
fi

for seg in "${SEGMENTS[@]}"; do
  if [ ! -f "$AUDIO/${seg}.wav" ] || [ ! -f "$CLIPS/${seg}.webm" ]; then
    echo "Skipping $seg — missing audio or clip"
    continue
  fi

  vo_dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$AUDIO/${seg}.wav")
  echo "=== ${seg} (${vo_dur}s) ==="

  # Trim video to voiceover length (mobile 390x844)
  ffmpeg -y -i "$CLIPS/${seg}.webm" \
    -t "$vo_dur" \
    -vf "scale=390:844,fps=25" \
    -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p \
    -an \
    "$CLIPS/${seg}.mp4" 2>/dev/null

  # Trim bg music
  ffmpeg -y -i "$BG_MUSIC" -t "$vo_dur" \
    -af "afade=t=in:st=0:d=1,afade=t=out:st=$(echo "$vo_dur - 1.5" | bc):d=1.5" \
    "$DIR/_bg.wav" 2>/dev/null

  # Mix voiceover + bg
  ffmpeg -y \
    -i "$AUDIO/${seg}.wav" \
    -i "$DIR/_bg.wav" \
    -filter_complex "[0]volume=1.0[vo];[1]volume=0.12[bg];[vo][bg]amix=inputs=2:duration=first[out]" \
    -map "[out]" "$DIR/_mix.wav" 2>/dev/null

  # Combine video + audio
  ffmpeg -y \
    -i "$CLIPS/${seg}.mp4" \
    -i "$DIR/_mix.wav" \
    -c:v copy -c:a aac -b:a 192k -shortest \
    "$OUT/${seg}.mp4" 2>/dev/null

  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/${seg}.mp4" | xargs printf "%.1f")
  size=$(du -h "$OUT/${seg}.mp4" | cut -f1)
  echo "  -> ${dur}s / ${size}"
done

rm -f "$DIR/_bg.wav" "$DIR/_mix.wav"

echo ""
echo "=== All help videos complete ==="
ls -lh "$OUT"
