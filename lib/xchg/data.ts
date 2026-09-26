// Mock data for the XCHG UI until a real API exists. Components only depend
// on these types, so swapping the source later shouldn't touch them.

export type Category =
  | "Tutoring"
  | "Music"
  | "Repairs"
  | "Pets"
  | "Beauty"
  | "Creative"
  | "Fitness"
  | "Tech";

export type Service = {
  id: string;
  title: string;
  category: Category;
  rating: number;
  ratingCount: number;
  location: string;
  zip: string;
  tags: string[];
};

export type ZipArea = {
  zip: string;
  neighborhood: string;
  lat: number;
  lng: number;
};

export type Notification = {
  id: string;
  text: string;
  read: boolean;
};

export const zipAreas: ZipArea[] = [
  { zip: "10024", neighborhood: "Upper West Side", lat: 40.7864, lng: -73.9765 },
  { zip: "10025", neighborhood: "Manhattan Valley", lat: 40.7985, lng: -73.9681 },
  { zip: "10026", neighborhood: "Central Harlem", lat: 40.8025, lng: -73.9525 },
  { zip: "10027", neighborhood: "Morningside Heights", lat: 40.8116, lng: -73.9531 },
  { zip: "10029", neighborhood: "East Harlem", lat: 40.7918, lng: -73.9438 },
  { zip: "10031", neighborhood: "Hamilton Heights", lat: 40.8251, lng: -73.9502 },
];

export const services: Service[] = [
  {
    id: "guitar",
    title: "Guitar Lessons",
    category: "Music",
    rating: 4.9,
    ratingCount: 126,
    location: "Morningside Heights",
    zip: "10027",
    tags: ["Beginner", "Acoustic", "Weekends", "Theory", "Electric", "Kids"],
  },
  {
    id: "calculus",
    title: "Calculus Tutoring",
    category: "Tutoring",
    rating: 4.8,
    ratingCount: 88,
    location: "Morningside Heights",
    zip: "10027",
    tags: ["Exams", "Remote", "Evenings", "AP", "College", "Weekly"],
  },
  {
    id: "bike",
    title: "Bike Tune-Ups",
    category: "Repairs",
    rating: 4.7,
    ratingCount: 64,
    location: "Manhattan Valley",
    zip: "10025",
    tags: ["Same day", "Parts", "Road", "Commuter", "Flats", "Pickup"],
  },
  {
    id: "dog-walking",
    title: "Dog Walking",
    category: "Pets",
    rating: 5.0,
    ratingCount: 41,
    location: "Upper West Side",
    zip: "10024",
    tags: ["Daily", "Big dogs", "Park", "Photos", "Puppies", "Weekends"],
  },
  {
    id: "haircuts",
    title: "Haircuts & Fades",
    category: "Beauty",
    rating: 4.6,
    ratingCount: 203,
    location: "Central Harlem",
    zip: "10026",
    tags: ["Walk-ins", "Fades", "Beards", "Kids", "Evenings", "Weekends"],
  },
  {
    id: "portraits",
    title: "Portrait Photos",
    category: "Creative",
    rating: 4.9,
    ratingCount: 37,
    location: "Hamilton Heights",
    zip: "10031",
    tags: ["Headshots", "Outdoor", "Edits", "Couples", "Events", "1 hour"],
  },
  {
    id: "laptop",
    title: "Laptop Repair",
    category: "Tech",
    rating: 4.5,
    ratingCount: 72,
    location: "East Harlem",
    zip: "10029",
    tags: ["Screens", "Batteries", "Mac", "Windows", "Data", "Same week"],
  },
  {
    id: "yoga",
    title: "Yoga in the Park",
    category: "Fitness",
    rating: 4.8,
    ratingCount: 58,
    location: "Manhattan Valley",
    zip: "10025",
    tags: ["All levels", "Outdoor", "Mornings", "Mats", "Groups", "Weekly"],
  },
  {
    id: "spanish",
    title: "Spanish Practice",
    category: "Tutoring",
    rating: 4.7,
    ratingCount: 29,
    location: "Central Harlem",
    zip: "10026",
    tags: ["Speaking", "Remote", "Beginner", "Travel", "Weekly", "Evenings"],
  },
  {
    id: "piano",
    title: "Piano Lessons",
    category: "Music",
    rating: 4.9,
    ratingCount: 95,
    location: "Upper West Side",
    zip: "10024",
    tags: ["Kids", "Adults", "Classical", "Jazz", "Recitals", "In-home"],
  },
  {
    id: "websites",
    title: "Website Setup",
    category: "Tech",
    rating: 4.6,
    ratingCount: 19,
    location: "Hamilton Heights",
    zip: "10031",
    tags: ["Portfolio", "Domains", "Remote", "SEO", "Shops", "1 week"],
  },
  {
    id: "cat-sitting",
    title: "Cat Sitting",
    category: "Pets",
    rating: 4.9,
    ratingCount: 33,
    location: "East Harlem",
    zip: "10029",
    tags: ["Overnight", "Meds", "Photos", "Holidays", "Plants", "Multi-cat"],
  },
  {
    id: "braids",
    title: "Braids & Twists",
    category: "Beauty",
    rating: 4.8,
    ratingCount: 112,
    location: "Hamilton Heights",
    zip: "10031",
    tags: ["Box braids", "Twists", "Kids", "Weekends", "Products", "Home visits"],
  },
  {
    id: "assembly",
    title: "Furniture Assembly",
    category: "Repairs",
    rating: 4.7,
    ratingCount: 81,
    location: "Morningside Heights",
    zip: "10027",
    tags: ["IKEA", "Same day", "Tools", "Mounting", "Shelves", "Evenings"],
  },
  {
    id: "training",
    title: "Personal Training",
    category: "Fitness",
    rating: 4.6,
    ratingCount: 47,
    location: "East Harlem",
    zip: "10029",
    tags: ["Strength", "Beginner", "Nutrition", "Home", "Mornings", "Park"],
  },
  {
    id: "murals",
    title: "Murals & Signs",
    category: "Creative",
    rating: 4.8,
    ratingCount: 15,
    location: "Central Harlem",
    zip: "10026",
    tags: ["Storefronts", "Murals", "Lettering", "Design", "Outdoor", "Custom"],
  },
];

export const notifications: Notification[] = [
  { id: "n1", text: "Emily messaged you about Guitar Lessons", read: false },
  { id: "n2", text: "New request: Calculus Tutoring", read: false },
  { id: "n3", text: "Bike Tune-Ups got a 5★ review", read: true },
  { id: "n4", text: "Alex wants to trade for Piano Lessons", read: false },
  { id: "n5", text: "Dog Walking tomorrow at 9:00 AM", read: true },
  { id: "n6", text: "Your profile is 80% complete", read: true },
  { id: "n7", text: "3 new services near 10027", read: true },
  { id: "n8", text: "Welcome to XCHG!", read: true },
];
