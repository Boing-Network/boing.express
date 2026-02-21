# Hero object extraction

Extract the Boing robot and 3D objects from `public/images/boing_robot_hero.png` for layered 3D motion on the landing page.

## Quick start (rembg + connected components)

```bash
pip install -r scripts/requirements-extract.txt
python scripts/extract_hero_objects.py
```

Output: `public/images/hero_objects/` with `manifest.json`, `hero_robot.png`, and optionally `hero_object_1.png`, etc. The frontend loads the manifest and renders each layer with 3D animations.

## Higher precision (Segment Anything Model)

For more accurate separation of robot vs jellyfish/coral/bubbles:

1. Install SAM and download a checkpoint:
   ```bash
   pip install segment-anything torch torchvision
   # Download sam_vit_b_01ec64.pth (375MB) from
   # https://github.com/facebookresearch/segment-anything#model-checkpoints
   mkdir -p scripts/checkpoints
   # place the .pth file in scripts/checkpoints/
   ```

2. Run:
   ```bash
   python scripts/extract_hero_sam.py
   ```

This overwrites the same `public/images/hero_objects/` output and manifest format.

## Manifest format

`manifest.json`:

```json
{
  "environment": "hero_environment.png",
  "robot": "hero_robot.png",
  "objects": ["hero_object_1.png", "hero_object_2.png", ...]
}
```

- **environment**: background-only layer (no foreground); used for full-page ambient layer.
- **robot**: main character (hero + full-page 3D slots with strongest motion).
- **objects**: environment objects (jellyfish, coral, etc. when SAM used); full-page 3D + hero mid layer.
