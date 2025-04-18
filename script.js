const routes = {
    "/": "/pages/home.html",
    "/about": "/pages/about.html",
    "/contact": "/pages/contact.html",
    "/restaurant": "/pages/restaurantModel.html"
};

const loadPage = async (path) => {
    const html = await fetch(routes[path]).then(res => res.text());
    document.getElementById("app").innerHTML = html;
};

const handleRoute = (event) => {
    event.preventDefault();
    const path = event.target.getAttribute("href");
    window.history.pushState({}, "", path);
    loadPage(path);
};

document.querySelectorAll("a[data-link]").forEach(link => {
    link.addEventListener("click", handleRoute);
});

window.addEventListener("popstate", () => {
    loadPage(window.location.pathname);
});

// Initial page load
loadPage(window.location.pathname);
