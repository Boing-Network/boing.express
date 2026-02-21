#!/usr/bin/env python3
"""
Extract the Boing hero robot and all distinct 3D objects from the composite PNG.
Uses rembg (background removal) + connected-components to separate each object.
Outputs: public/images/hero_objects/*.png + manifest.json for the frontend.

Run from repo root:
  pip install -r scripts/requirements-extract.txt
  python scripts/extract_hero_objects.py
"""
from pathlib import Path
import json
import sys

import numpy as np
from PIL import Image
from scipy.ndimage import binary_dilation, binary_erosion, label
from rembg import remove

# Paths (repo root = parent of scripts/)
ROOT = Path(__file__).resolve().parent.parent
INPUT_IMAGE = ROOT / "public" / "images" / "boing_robot_hero.png"
OUTPUT_DIR = ROOT / "public" / "images" / "hero_objects"
MIN_OBJECT_AREA_RATIO = 0.002  # ignore blobs smaller than 0.2% of image
CONNECTIVITY = 2  # 2 = 8-connected (diagonals count)
ERODE_PX = 3  # slight erosion to separate touching objects before connected components


def main():
    if not INPUT_IMAGE.exists():
        print(f"Input image not found: {INPUT_IMAGE}", file=sys.stderr)
        sys.exit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Loading image...")
    pil_img = Image.open(INPUT_IMAGE).convert("RGBA")
    img = np.array(pil_img)
    h, w = img.shape[:2]
    total_pixels = h * w
    min_area = int(total_pixels * MIN_OBJECT_AREA_RATIO)

    print("Removing background (rembg)...")
    no_bg = remove(pil_img)
    no_bg_arr = np.array(no_bg)
    alpha = no_bg_arr[:, :, 3]

    # Binarize: foreground = 1, background = 0
    binary = (alpha > 127).astype(np.uint8)

    # Optional: erode to separate touching objects, then label; dilate back for full extent per object
    if ERODE_PX > 0:
        binary_eroded = binary_erosion(binary, iterations=ERODE_PX).astype(np.uint8)
        labeled_eroded, num_features = label(binary_eroded, structure=np.ones((3, 3)))
        labeled = np.zeros_like(binary, dtype=np.int32)
        for i in range(1, num_features + 1):
            seed = (labeled_eroded == i)
            if not seed.any():
                continue
            expanded = binary_dilation(seed, iterations=ERODE_PX + 2).astype(bool) & binary.astype(bool)
            labeled[expanded] = i
        num_objects = num_features
    else:
        labeled, num_features = label(binary, structure=np.ones((3, 3)))
        num_objects = num_features
    # label 0 is background
    num_objects = num_features

    # Collect each object's mask and stats (use original binary for mask so we don't lose pixels)
    objects = []
    for i in range(1, num_objects + 1):
        mask = (labeled == i).astype(np.uint8)
        if mask.sum() == 0:
            continue
        area = mask.sum()
        if area < min_area:
            continue
        yy, xx = np.where(mask)
        cy, cx = yy.mean(), xx.mean()
        # distance from center (normalized 0–1)
        dist_from_center = np.sqrt((cy / h - 0.5) ** 2 + (cx / w - 0.5) ** 2)
        objects.append({
            "mask": mask,
            "area": int(area),
            "cx": float(cx),
            "cy": float(cy),
            "dist_from_center": float(dist_from_center),
        })

    # Sort: largest first, then by proximity to center (robot is usually central and large)
    objects.sort(key=lambda o: (-o["area"], o["dist_from_center"]))

    if not objects:
        print("No objects above minimum area. Try lowering MIN_OBJECT_AREA_RATIO.", file=sys.stderr)
        sys.exit(1)

    # Export environment layer (background only): original with foreground masked out
    env_rgba = img.copy()
    env_rgba[:, :, 3] = (255 - binary * 255).astype(np.uint8)
    env_path = OUTPUT_DIR / "hero_environment.png"
    Image.fromarray(env_rgba).save(env_path, "PNG")
    print(f"  hero_environment.png (background layer)")

    print(f"Exporting {len(objects)} objects...")
    manifest = {"environment": "hero_environment.png", "robot": None, "objects": []}

    for i, obj in enumerate(objects):
        mask = obj["mask"]
        # RGBA: original RGB, alpha = mask (255 where object, 0 elsewhere)
        rgba = img.copy()
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
        print(f"  {filename} (area={obj['area']}, center=({obj['cx']:.0f},{obj['cy']:.0f}))")

    manifest_path = OUTPUT_DIR / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    print(f"Wrote {manifest_path}")
    print("Done. Use hero_objects/ in the frontend: environment + robot + objects for full-page 3D.")


if __name__ == "__main__":
    main()
