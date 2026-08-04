from pathlib import Path
import sys

SKILL = Path.home() / ".pi/agent/skills/pixel-art-studio"
sys.path.insert(0, str(SKILL / "scripts"))

from pixelstudio import Sprite

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "src/dashboard/assets/rooftop-refuge.png"

PALETTE = [
    "#49392f",  # walnut outline
    "#755c4d",  # warm shadow
    "#416c7b",  # zinc roof
    "#8fb8c4",  # mountain air
    "#126d69",  # deep teal
    "#69c1b5",  # screen glow
    "#d98a62",  # window light
    "#cdb9a5",  # limestone shadow
    "#f4e4ce",  # limestone light
]

s = Sprite(80, 32, palette=PALETTE)

# A quiet mountain pass behind the observer's roof.
s.polygon([(0, 27), (0, 24), (5, 24), (5, 21), (9, 21), (9, 18), (13, 18), (13, 14), (17, 14), (17, 11), (20, 11), (20, 14), (24, 14), (24, 18), (29, 18), (29, 22), (36, 22), (36, 27)], PALETTE[2])
s.polygon([(7, 28), (7, 26), (13, 26), (13, 23), (18, 23), (18, 20), (23, 20), (23, 17), (28, 17), (28, 13), (32, 13), (32, 9), (35, 9), (35, 12), (39, 12), (39, 16), (43, 16), (43, 28)], PALETTE[3])
s.rect(17, 11, 20, 12, PALETTE[8])
s.rect(32, 9, 35, 10, PALETTE[8])
s.rect(28, 13, 31, 14, PALETTE[8])

# Small trail lights suggest exploration without becoming a diagram.
s.rect(5, 23, 6, 24, PALETTE[5])
s.rect(17, 21, 18, 22, PALETTE[5])
s.rect(30, 16, 31, 17, PALETTE[6])

# Zinc roof and limestone wall form a compact Parisian refuge.
s.polygon([(30, 27), (42, 14), (66, 14), (78, 27)], PALETTE[0])
s.polygon([(33, 26), (44, 15), (64, 15), (75, 26)], PALETTE[2])
s.line(44, 15, 64, 15, PALETTE[3])
s.rect(34, 26, 77, 31, PALETTE[7])
s.line(34, 26, 77, 26, PALETTE[8])

# The observer's dormer: limestone frame, one warm lamp, tiny teal terminal.
s.rect(45, 15, 62, 27, PALETTE[0])
s.polygon([(44, 16), (53, 8), (63, 16)], PALETTE[0])
s.polygon([(47, 15), (53, 10), (60, 15)], PALETTE[2])
s.rect(47, 17, 60, 25, PALETTE[7])
s.rect(48, 18, 59, 24, PALETTE[8])
s.rect(50, 20, 56, 23, PALETTE[4])
s.rect(51, 20, 55, 21, PALETTE[5])
s.rect(57, 19, 58, 21, PALETTE[6])
s.px(58, 23, PALETTE[4])

# Chimney and aerial break symmetry; the light remains local.
s.rect(67, 10, 71, 23, PALETTE[0])
s.rect(68, 11, 70, 22, PALETTE[1])
s.line(69, 10, 69, 6, PALETTE[1])
s.line(69, 7, 73, 7, PALETTE[1])
s.px(74, 7, PALETTE[5])

OUT.parent.mkdir(parents=True, exist_ok=True)
s.save_png(OUT)
s.preview(Path(__file__).with_name("preview.png"), scale=8, bg="#211a17", grid=False, labels=False)
s.save_silhouette(Path(__file__).with_name("silhouette.png"))
s.save_swatch(Path(__file__).with_name("swatch.png"))
s.stats()
