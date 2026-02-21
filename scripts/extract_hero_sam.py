#!/usr/bin/env python3
"""
High-precision extraction using Segment Anything Model (SAM).
Produces the same output layout as extract_hero_objects.py so the frontend can use either.

Setup (one-time):
  pip install segment-anything torch torchvision opencv-python-headless
  # Download checkpoint (e.g. sam_vit_b_01ec64.pth) from
  # https://github.com/facebookresearch/segment-anything#model-checkpoints
  # Put it in scripts/checkpoints/ or set SAM_CHECKPOINT env var.

Run from repo root:
  python scripts/extract_hero_sam.py
"""
from pathlib import Path
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
INPUT_IMAGE = ROOT / "public" / "images" / "boing_robot_hero.png"
OUTPUT_DIR = ROOT / "public" / "images" / "hero_objects"
CHECKPOINT_DIR = Path(__file__).resolve().parent / "checkpoints"
MIN_OBJECT_AREA_RATIO = 0.005  # ignore small masks
DEFAULT_CHECKPOINT = "sam_vit_b_01ec64.pth"  # smaller, faster model


def get_checkpoint():
    env = os.environ.get("SAM_CHECKPOINT")
    if env and Path(env).exists():
        return env
    for name in (DEFAULT_CHECKPOINT, "sam_vit_h_4b8939.pth"):
        p = CHECKPOINT_DIR / name
        if p.exists():
            return str(p)
    return None


def main():
    if not INPUT_IMAGE.exists():
        print(f"Input image not found: {INPUT_IMAGE}", file=sys.stderr)
        sys.exit(1)

    checkpoint = get_checkpoint()
    if not checkpoint:
        print(
            "SAM checkpoint not found. Download one of:\n"
            "  sam_vit_b_01ec64.pth  (375MB)\n"
            "  sam_vit_h_4b8939.pth  (2.4GB)\n"
            "from https://github.com/facebookresearch/segment-anything#model-checkpoints\n"
            "and place in scripts/checkpoints/ or set SAM_CHECKPOINT.",
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        import torch
        from segment_anything import sam_model_registry, SamAutomaticMaskGenerator
    except ImportError as e:
        print(f"Install segment-anything and torch: pip install segment-anything torch torchvision\n{e}", file=sys.stderr)
        sys.exit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)

    print("Loading image...")
    pil_img = Image.open(INPUT_IMAGE).convert("RGBA")
    img_rgba = np.array(pil_img)
    img_rgb = img_rgba[:, :, :3]
    h, w = img_rgb.shape[:2]
    total_pixels = h * w
    min_area = int(total_pixels * MIN_OBJECT_AREA_RATIO)

    print("Loading SAM model...")
    if "vit_b" in checkpoint:
        model_type = "vit_b"
    elif "vit_h" in checkpoint:
        model_type = "vit_h"
    else:
        model_type = "vit_b"
    device = "cuda" if torch.cuda.is_available() else "cpu"
    sam = sam_model_registry[model_type](checkpoint=checkpoint)
    sam.to(device=device)
    mask_generator = SamAutomaticMaskGenerator(
        model=sam,
        points_per_side=32,
        pred_iou_thresh=0.86,
        stability_score_thresh=0.92,
        min_mask_region_area=min_area,
    )

    print("Running automatic mask generation (this may take a minute)...")
    masks = mask_generator.generate(img_rgb)

    # Sort by area descending, then by distance from center
    def center_dist(m):
        y, x = m["bbox"][1] + m["bbox"][3] / 2, m["bbox"][0] + m["bbox"][2] / 2
        return (x / w - 0.5) ** 2 + (y / h - 0.5) ** 2

    masks = [m for m in masks if m["area"] >= min_area]
    masks.sort(key=lambda m: (-m["area"], center_dist(m)))

    if not masks:
        print("No masks above minimum area.", file=sys.stderr)
        sys.exit(1)

    print(f"Exporting {len(masks)} segments...")
    manifest = {"robot": None, "objects": []}

    for i, m in enumerate(masks):
        mask = m["segmentation"]
        rgba = img_rgba.copy()
        rgba[:, :, 3] = (mask * 255).astype(np.uint8)
        out_pil = Image.fromarray(rgba)

        if i == 0:
            filename = "hero_robot.png"
            manifest["robot"] = filename
        else:
            filename = f"hero_object_{i}.png"
            manifest["objects"].append(filename)

        out_path = OUTPUT_DIR / filename
        out_pil.save(out_path, "PNG")
        print(f"  {filename} (area={m['area']})")

    manifest_path = OUTPUT_DIR / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    print(f"Wrote {manifest_path}")
    print("Done.")


if __name__ == "__main__":
    main()
