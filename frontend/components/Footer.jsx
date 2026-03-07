export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-10 border-t border-orange-200 bg-white/90">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-center px-4 py-6 md:px-8">
        <p className="text-sm text-orange-700">Copyright {year} UbonCity.com : Contact Number +6664-985-0555</p>
      </div>
    </footer>
  );
}
