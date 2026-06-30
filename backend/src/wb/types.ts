/**
 * Minimal typed shapes for the Wildberries responses we consume. Only the
 * fields WB Shturval actually uses are typed; everything else is ignored.
 * See WILDBERRIES_API_NOTES.md for the authoritative field reference.
 */

export interface WbOrder {
  date: string;
  lastChangeDate: string;
  supplierArticle: string;
  nmId: number;
  barcode?: string;
  category?: string;
  subject?: string;
  brand?: string;
  techSize?: string;
  warehouseName?: string;
  totalPrice?: number;
  discountPercent?: number;
  finishedPrice?: number;
  priceWithDisc?: number;
  isCancel?: boolean;
  srid: string;
}

export interface WbSale {
  date: string;
  lastChangeDate: string;
  supplierArticle: string;
  nmId: number;
  barcode?: string;
  category?: string;
  subject?: string;
  brand?: string;
  warehouseName?: string;
  totalPrice?: number;
  discountPercent?: number;
  finishedPrice?: number;
  priceWithDisc?: number;
  forPay?: number;
  saleID: string; // "S..." = sale, "R..." = return
}

export interface WbStock {
  lastChangeDate: string;
  supplierArticle: string;
  nmId: number;
  barcode?: string;
  warehouseName?: string;
  category?: string;
  subject?: string;
  brand?: string;
  quantity: number; // available to sell
  inWayToClient?: number;
  inWayFromClient?: number;
  quantityFull?: number;
}

export interface WbReportRow {
  realizationreport_id?: number;
  rrd_id: number;
  nm_id?: number;
  sa_name?: string;
  doc_type_name?: string;
  quantity?: number;
  retail_price?: number;
  retail_amount?: number;
  ppvz_for_pay?: number;
  delivery_rub?: number;
  storage_fee?: number;
  penalty?: number;
  deduction?: number;
  acceptance?: number;
  return_amount?: number;
  commission_percent?: number;
  date_from?: string;
  date_to?: string;
  sale_dt?: string;
  rr_dt?: string;
}

export interface WbCard {
  nmID: number;
  vendorCode: string;
  brand?: string;
  title?: string;
  subjectName?: string;
  photos?: Array<{ big?: string; c246x328?: string; square?: string }>;
  sizes?: Array<{ skus?: string[] }>;
}

export interface WbCardsResponse {
  cards?: WbCard[];
  cursor?: { updatedAt?: string; nmID?: number; total?: number };
}

export interface WbAdvCampaignCount {
  adverts?: Array<{
    type?: number;
    status?: number;
    advert_list?: Array<{ advertId: number; changeTime?: string }>;
  }>;
  all?: number;
}

/** adv/v3/fullstats — per-campaign stats with day/nm breakdown. */
export interface WbAdvFullStat {
  advertId: number;
  days?: Array<{
    date?: string;
    apps?: Array<{
      nm?: Array<{
        nmId: number;
        sum?: number;
        views?: number;
        clicks?: number;
        orders?: number;
      }>;
    }>;
  }>;
}
