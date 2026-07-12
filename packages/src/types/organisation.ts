export type BusinessCategory = 'fitness' | 'real-estate' | 'service-business' | 'restaurant' | 'haircut-and-salon'

export type Image = {
  name: string
  url: string
  size: string
  mime_type: string
}

export type OrganisationStatus = 'pending' | 'active'

export type Organisation = {
  uuid: string
  id: string
  name: string
  status: OrganisationStatus
  image: Image | null
  business_category: BusinessCategory
  template_id: string
  plan_id: string
  created_at: string
  description?: string
}

export type OrganisationRole = 'owner' | 'admin' | 'manager' | 'editor' | 'staff' | 'guest'

export type OrganisationUser = {
  role: OrganisationRole
  position?: string
  joined_date: string
}

export type User = {
  status: 'unverified' | 'verified'
  profile: string
}
