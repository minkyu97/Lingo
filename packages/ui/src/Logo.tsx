/** The logo keeps its own colors in both themes. */
const APPLE = "#e5484d";
const SHINE = "#ffffff";
const STEM = "#8b5a2b";
const LEAF = "#4cb866";
const INK = "#4a1d1f";
const BLUSH = "#ffb3bd";

export interface LogoProps {
  /**
   * `face` from 24px up. `plain` below that, where a face would not read.
   */
  detail?: "face" | "plain";
  /** Edge length in px. */
  size?: number;
}

/**
 * The Lingo mark: an apple. The name joins "linguistics" with ringo, the
 * Japanese word for apple. It is decorative, so name whatever it sits in.
 */
export function Logo({ detail = "face", size = 24 }: LogoProps) {
  return (
    <svg
      className="lingo-logo"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        fill={APPLE}
        d="M12 7.875C10.5 6 7.125 5.625 5.25 7.125C2.625 9.1875 2.25 13.5 3.75 16.875C5.25 20.25 8.25 22.125 10.125 21.5625C11.0625 21.3 11.55 21.075 12 21.075C12.45 21.075 12.9375 21.3 13.875 21.5625C15.75 22.125 18.75 20.25 20.25 16.875C21.75 13.5 21.375 9.1875 18.75 7.125C16.875 5.625 13.5 6 12 7.875Z"
      />
      <path
        fill={SHINE}
        d="M5.49474 11.7805C5.97019 12.0333 6.74972 11.4971 7.23588 10.5827C7.72203 9.66841 7.73071 8.72227 7.25526 8.46947C6.77981 8.21667 6.00028 8.75294 5.51413 9.66726C5.02797 10.5816 5.01929 11.5277 5.49474 11.7805Z"
      />
      <path
        fill={STEM}
        d="M11.4375 8.25C11.4375 6.27195 12.0306 4.42395 13.2898 3.1648C13.5095 2.94513 13.8655 2.94513 14.0852 3.1648C14.3049 3.38447 14.3049 3.74054 14.0852 3.96021C13.0944 4.95105 12.5625 6.47806 12.5625 8.25C12.5625 8.56066 12.3107 8.8125 12 8.8125C11.6893 8.8125 11.4375 8.56066 11.4375 8.25Z"
      />
      <path
        fill={LEAF}
        d="M13.875 4.875C14.25 2.8125 16.5 1.6875 19.125 2.0625C19.3125 4.3125 16.875 5.8125 13.875 4.875Z"
      />
      {detail === "face" && (
        <g data-part="face">
          <circle cx="9" cy="13.5" r="0.9" fill={INK} />
          <circle cx="15" cy="13.5" r="0.9" fill={INK} />
          <path
            fill={INK}
            d="M12.9877 15.1875C13.0912 15.0082 13.3206 14.9467 13.5 15.0502C13.6793 15.1537 13.7408 15.3831 13.6373 15.5625C12.9305 16.7875 11.0695 16.7875 10.3627 15.5625C10.2592 15.3831 10.3207 15.1537 10.5 15.0502C10.6794 14.9467 10.9088 15.0082 11.0123 15.1875C11.4305 15.9124 12.5695 15.9124 12.9877 15.1875Z"
          />
          <ellipse cx="6.9375" cy="15.5625" rx="1.2" ry="0.825" fill={BLUSH} />
          <ellipse cx="17.0625" cy="15.5625" rx="1.2" ry="0.825" fill={BLUSH} />
        </g>
      )}
    </svg>
  );
}
