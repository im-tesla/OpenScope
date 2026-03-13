import cv2
import numpy as np
import glob

BLOCK_SZ = 32
FOCUS_THRESH_PCT = 0.15
FOCUS_THRESH_MIN = 30.0


def laplacian_var(img):
    return cv2.Laplacian(img, cv2.CV_64F).var()


def block_focus_map(img, bs=BLOCK_SZ):
    lap = cv2.Laplacian(img, cv2.CV_64F)
    bh, bw = img.shape[0] // bs, img.shape[1] // bs
    out = np.zeros((bh, bw))
    for r in range(bh):
        for c in range(bw):
            out[r, c] = lap[r*bs:(r+1)*bs, c*bs:(c+1)*bs].var()
    return out


def load_images(pattern="[0-9]*.jpg"):
    files = sorted(glob.glob(pattern))
    if not files:
        return [], []

    raw = [cv2.imread(f, cv2.IMREAD_GRAYSCALE) for f in files]
    if any(r is None for r in raw):
        bad = [f for f, r in zip(files, raw) if r is None]
        print(f"failed to read: {bad}")
        return [], []

    h = min(r.shape[0] for r in raw)
    w = min(r.shape[1] for r in raw)
    imgs = [r[:h, :w] for r in raw]
    return files, imgs


def save_heatmaps(files, bmaps):
    try:
        import matplotlib.pyplot as plt
    except ImportError:
        return

    n = len(files)
    fig, axes = plt.subplots(1, n, figsize=(3*n, 3))
    if n == 1:
        axes = [axes]

    vlo, vhi = np.min(bmaps), np.max(bmaps)
    for i, ax in enumerate(axes):
        ax.imshow(bmaps[i], cmap="hot", interpolation="nearest", vmin=vlo, vmax=vhi)
        ax.set_title(files[i])
        ax.axis("off")

    plt.suptitle("block focus (brighter = sharper)")
    plt.tight_layout()
    plt.savefig("focus_heatmaps.png", dpi=150)
    print("saved focus_heatmaps.png")


def main():
    files, imgs = load_images()
    if not imgs:
        print("no images found")
        return

    n = len(imgs)
    print(f"{n} images: {files}\n")

    scores = [laplacian_var(im) for im in imgs]
    bmaps = np.array([block_focus_map(im) for im in imgs])
    total_blocks = bmaps.shape[1] * bmaps.shape[2]

    best = int(np.argmax(scores))

    print("-- focus scores --")
    for i in range(n):
        tag = " <-- best" if i == best else ""
        print(f"  {files[i]}: {scores[i]:.2f}{tag}")

    print("\n-- area where each step is sharpest --")
    winners = np.argmax(bmaps, axis=0)
    for i in range(n):
        pct = np.sum(winners == i) / total_blocks * 100
        print(f"  {files[i]}: {pct:.1f}%")

    thresh = max(np.max(bmaps) * FOCUS_THRESH_PCT, FOCUS_THRESH_MIN)
    print(f"\n-- absolute focus (block var > {thresh:.1f}) --")
    for i in range(n):
        pct = np.sum(bmaps[i] > thresh) / total_blocks * 100
        print(f"  {files[i]}: {pct:.1f}% in focus")

    # weighted center of focus across the z-stack
    w_sum = sum(s * idx for idx, s in enumerate(scores))
    cof = w_sum / sum(scores) if sum(scores) > 0 else 0

    print(f"\n-- correction --")
    print(f"  peak at index {best} ({files[best]})")
    print(f"  interpolated center: {cof:.2f}")
    if best > 0:
        print(f"  move forward {best} step(s)")
    else:
        print(f"  already at front of range")

    save_heatmaps(files, bmaps)


if __name__ == "__main__":
    main()
