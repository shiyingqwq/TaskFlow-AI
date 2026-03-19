import { ImageResponse } from "next/og";

export const contentType = "image/png";
export const size = {
  width: 180,
  height: 180,
};

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          background: "#fffaf3",
          color: "#b24b2a",
          fontSize: 88,
          fontWeight: 700,
          borderRadius: 42,
          border: "10px solid rgba(178,75,42,0.14)",
        }}
      >
        事
      </div>
    ),
    size,
  );
}
