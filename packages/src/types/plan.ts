export type Plan = {
  uuid: string
  plan_id: string // slug e.g. "basic" | "pro" — must be unique
  name: string
  info: string
  included: string[]
}
