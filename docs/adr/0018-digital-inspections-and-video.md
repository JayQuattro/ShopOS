# ADR 0018: Digital vehicle inspections and video providers

Date: 2026-08-26

## Status

Accepted (scaffold)

## Context

Digital vehicle inspections are the highest-value missing workflow (the
Tekmetric/Shopmonkey benchmark: photo-rich inspections correlate with ~30%
higher repair orders). Inspections need per-item photos and increasingly
**video** — and video is a different problem from object storage: raw phone
MP4s are large, play poorly without adaptive streaming, and benefit from
provider-side transcoding, thumbnails, and playback APIs (Mux, Cloudflare
Stream, api.video, Bunny Stream).

## Decision

**DVI domain model**: an `Inspection` per work order (optionally from an
`InspectionTemplate` checklist) with positioned `InspectionItem`s carrying
condition (ok / watch / replace / n-a), free notes, and media. Items bridge to
money through a `recommend` action that adds an estimate line — the canned-job
link pattern the benchmarks sell. Sharing follows the signed-token pattern of
the repair tracker (no account, audit-logged).

**Video as a connector family (ADR 0008), capability `video`**:

- Interface v1: `createDirectUpload({title, externalReference}) →
{uploadId, uploadUrl}` and `getUpload(uploadId) → {status, playbackId,
assetId}`. Direct-upload means large files stream browser→provider without
  transiting ShopOS — the same shape across Mux/Cloudflare/api.video.
- **Mux** is the live adapter (direct uploads + playback IDs).
- **Local** mode rides the existing _storage_ connector family: the upload
  URL points at a ShopOS endpoint that streams bytes into the org's storage
  connector (local-disk in dev, S3/Azure in prod), and playback serves
  ranged GETs. No transcoding — honest about the tradeoff, zero external
  dependency, good for small videos.
- Planned slots: Cloudflare Stream, api.video, Bunny Stream — BYO,
  org-scoped, like payments.
- Photos remain plain attachments extended with an `inspectionItemId`; only
  video crosses into the connector family.

## Consequences

- Dev/test runs on local-via-storage with no credentials; Mux shops get
  adaptive streaming by pasting a token pair.
- Scaffold scope: schema, services, connectors, tests. Inspection UI, public
  share view, and the recommend-to-estimate button are follow-ups built on
  these seams.

## Out of scope for the scaffold

Webhooks for asset-ready callbacks; thumbnails; per-item video collections;
inspection-to-marketing reuse.
