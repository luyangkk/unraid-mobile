FROM node:22-alpine AS web-build
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.24-alpine AS go-build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . ./
COPY --from=web-build /src/web/dist/ ./cmd/server/web/
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/host-spike ./cmd/host-spike

FROM gcr.io/distroless/static-debian12
COPY --from=go-build /out/server /app/server
COPY --from=go-build /out/host-spike /app/host-spike
EXPOSE 8080
ENTRYPOINT ["/app/server"]
