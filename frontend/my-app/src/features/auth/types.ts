export type AuthUser = {
  id: number
  email: string
  displayName: string
}

export type RegisterResponse = {
  id: number
  display_name: string
  email: string
  created_at: string
}

export type LoginResponse = {
  access_token: string
}
