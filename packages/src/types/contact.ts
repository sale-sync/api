// packages/src/types/contact.ts

export type IContact = {
  workspace_uuid: string;
  id: string;
  name: string;
  mode: "b2b" | "b2c"
};

export type IContactBase = {
  id: string; // uuid
  contact_id: string; // which contact item is store at
  status: string;
  added_date: string; // ISO string
  updated_date: string; // ISO string
  note: string;
};

export type IB2BContact = {
  mode: "b2b";
  business_name: string;
  business_email: string;
  business_phone: string;
  spoke_person: {
    name: string;
    email: string;
    phone: string;
  }[];
} & IContactBase;

export type IB2CContact = {
  mode: "b2c";
  name: string;
  email: string;
  phone: string;
  business: {
    business_name: string;
    business_email: string;
    business_phone: string;
  }[];
} & IContactBase;

export type IContactItem = IB2BContact | IB2CContact;
