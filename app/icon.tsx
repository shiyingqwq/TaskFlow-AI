import { ImageResponse } from "next/og";

export const contentType = "image/png";
export const size = {
  width: 512,
  height: 512,
};

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(160deg, #fff7ed 0%, #f4d7ca 50%, #dbe9e6 100%)",
          color: "#1f1b17",
          fontSize: 188,
          fontWeight: 700,
          borderRadius: 112,
        }}
      >
        事
      </div>
    ),
    size,
  );
}
