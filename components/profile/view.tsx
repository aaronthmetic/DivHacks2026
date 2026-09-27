"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Star } from "lucide-react";
import type { ProfileCard, ProfileData } from "@/lib/profile-data";
import { DEFAULT_AVATAR, starFill } from "@/lib/profile-display";
import { ListingModal } from "@/components/barter/listing-modal";
import type { Service } from "@/lib/barter/data";
import { Button } from "@/components/ui/button";

export function Avatar({ src, name, large = false }: { src?: string | null; name: string; large?: boolean }) {
  // GridFS and OAuth images have dynamic origins; use the browser's image loader.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src || DEFAULT_AVATAR} alt={`${name}'s profile picture`} referrerPolicy="no-referrer" onError={e => { if (!e.currentTarget.src.endsWith(DEFAULT_AVATAR)) e.currentTarget.src = DEFAULT_AVATAR; }} className={`${large ? "size-32" : "size-10"} shrink-0 rounded-full object-cover bg-muted`} />;
}
export function Stars({ rating, count }: { rating: number; count?: number }) {
  const value = count === 0 ? 0 : rating;
  return <span className="inline-flex items-center gap-2" role="img" aria-label={`${value.toFixed(1)} out of 5 stars${count === undefined ? "" : `, ${count} reviews`}`}>
    <span className="flex" aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <span key={i} className="relative block size-6 text-amber-500"><Star className="size-6" /><span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${starFill(value, i)}%` }}><Star className="size-6 max-w-none fill-current" /></span></span>)}</span>
    {count !== undefined && <span aria-hidden="true" className="text-sm text-muted-foreground">({count})</span>}
  </span>;
}
function BookingModal({ card, onClose }: { card: ProfileCard | undefined; onClose: () => void }) {
  return <ListingModal service={card ? {
    id: card.id, title: card.title, description: card.description, category: card.category ?? "Other",
    images: card.images ?? (card.image ? [card.image] : []), rating: card.rating ?? 0, ratingCount: card.ratingCount ?? 0,
    location: card.location ?? "Remote", zip: card.zip ?? null, tags: card.tags ?? card.lines,
    availability: card.availability ?? [], providerId: card.providerId ?? card.provider?.id ?? "",
    providerName: card.providerName ?? card.provider?.name ?? "Member", own: false,
  } : null} onClose={onClose} />;
}
function Carousel({ title, cards, listings = false }: { title: string; cards: ProfileCard[]; listings?: boolean }) {
  const [index, setIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const card = cards[Math.min(index, Math.max(0, cards.length - 1))];
  const selected = cards.find(item => item.id === selectedId);
  const modalService: Service | null = selected ? {
    id: selected.id, title: selected.title, description: selected.description,
    category: selected.category ?? "Other", images: selected.images ?? (selected.image ? [selected.image] : []),
    rating: selected.rating ?? 0, ratingCount: selected.ratingCount ?? 0,
    location: selected.location ?? "Remote", zip: selected.zip ?? null,
    tags: selected.tags ?? selected.lines, availability: selected.availability ?? [],
    providerId: selected.providerId ?? selected.provider?.id ?? "", providerName: selected.providerName ?? selected.provider?.name ?? "Member", own: selected.own ?? false,
  } : null;
  return <section className="min-w-0 rounded-2xl border bg-white p-6 shadow-sm" aria-label={title}>
    <h2 className="mb-4 text-xl font-semibold text-barter-navy">{title}</h2>
    {card ? <>
      <button onClick={() => setSelectedId(card.id)} className="w-full space-y-3 rounded-xl border p-4 text-left transition hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" aria-label={`View ${card.title} details`}>
        <h3 className="text-lg font-semibold">{card.title}</h3>
        {card.provider && <p>With {card.provider.name}</p>}
        {card.lines.map((line, i) => <p key={i} className="text-sm capitalize text-muted-foreground">{line}</p>)}
        <p className="text-sm underline">View details</p>
      </button>
      <div className="mt-4 flex items-center justify-between gap-3">
        <Button variant="outline" size="icon" aria-label={`Previous ${title.toLowerCase()}`} disabled={index === 0} onClick={() => setIndex(i => i - 1)}><ChevronLeft /></Button>
        <span aria-live="polite" className="text-sm">{Math.min(index + 1, cards.length)} of {cards.length}</span>
        <Button variant="outline" size="icon" aria-label={`Next ${title.toLowerCase()}`} disabled={index >= cards.length - 1} onClick={() => setIndex(i => i + 1)}><ChevronRight /></Button>
      </div>
      {listings ? <ListingModal service={modalService} onClose={() => setSelectedId(null)} /> : <BookingModal card={selected} onClose={() => setSelectedId(null)} />}
    </> : <p className="py-12 text-center text-muted-foreground">{listings ? "No listings to show yet." : "No upcoming or pending bookings."}</p>}
  </section>;
}
export function ProfileView({ profile, basePath }: { profile: ProfileData; basePath: string }) {
  return <main className="min-h-screen bg-muted/30 px-4 py-8 sm:px-8">
    <div className="mx-auto max-w-5xl">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-barter-navy"><ArrowLeft className="size-4" />Back to barter</Link>
      <header className="flex flex-col items-center gap-4 py-10 text-center"><Avatar src={profile.image} name={profile.name} large /><h1 className="text-3xl font-bold text-barter-navy">{profile.name}</h1><Stars rating={profile.rating} count={profile.reviewCount} />{profile.isOwner && <Link href="/profile/edit" className="rounded-lg bg-barter-navy px-6 py-3 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-4">Edit profile</Link>}</header>
      <div className={`grid items-start gap-6 ${profile.isOwner ? "md:grid-cols-2" : ""}`}><Carousel title="Listings" cards={profile.listings} listings />{profile.isOwner && <Carousel title="Bookings" cards={profile.bookings} />}</div>
      <section className="mt-8 rounded-2xl border bg-white p-6" aria-labelledby="reviews-heading"><h2 id="reviews-heading" className="text-xl font-semibold text-barter-navy">Reviews</h2>
        {profile.reviews.length ? <ul className="divide-y">{profile.reviews.map(review => <li key={review.id} className="space-y-3 py-6"><div className="flex items-center gap-3"><Avatar src={review.authorImage} name={review.authorName} /><Link href={`/profile/${review.authorId}`} className="font-medium underline">{review.authorName}</Link><time dateTime={review.date} className="ml-auto text-sm text-muted-foreground">{review.date}</time></div><Stars rating={review.rating} /><p className="whitespace-pre-wrap break-words">{review.comment}</p></li>)}</ul> : <p className="py-6 text-muted-foreground">No reviews yet.</p>}
        {profile.reviewPages > 1 && <nav aria-label="Review pages" className="flex items-center justify-between gap-4 border-t pt-4">{profile.reviewsPage > 1 ? <Link className="underline" href={`${basePath}?reviewsPage=${profile.reviewsPage - 1}#reviews-heading`}>Previous</Link> : <span className="text-muted-foreground">Previous</span>}<span>Page {profile.reviewsPage} of {profile.reviewPages}</span>{profile.reviewsPage < profile.reviewPages ? <Link className="underline" href={`${basePath}?reviewsPage=${profile.reviewsPage + 1}#reviews-heading`}>Next</Link> : <span className="text-muted-foreground">Next</span>}</nav>}
      </section>
    </div>
  </main>;
}
