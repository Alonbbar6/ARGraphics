import Foundation

/// JSON shaped exactly like the `ios` schemas in lib/api-spec/openapi.yaml,
/// plus unknown extra fields the app must ignore.
enum Fixtures {
    static let venueSummary = """
    {"slug":"casa-marisol","name":"Casa Marisol","kind":"venue","neighborhood":"Little Havana",
     "bio":"Sixty seats.","futureField":42}
    """

    static let offerDisplay = """
    {"id":"dsp_offer1","type":"promo_offer","placement":"table","title":"Free agua fresca",
     "description":"With any birria tower","mediaUrl":null,"thumbnailUrl":null,"modelUsdzUrl":null,
     "modelGlbUrl":null,"price":null,
     "offer":{"title":"Free agua fresca with any birria tower","details":"One per guest.",
              "endsAt":"2026-10-15T03:00:00.000Z","extra":"x"},
     "eventStartsAt":null,"artist":null,"newThing":{"a":1}}
    """

    static let artDisplay = """
    {"id":"dsp_art1","type":"art_piece","placement":"wall","title":"Night Bloom","description":"After dark.",
     "mediaUrl":"https://h.example/api/storage/public-objects/bloom.webp","thumbnailUrl":null,
     "modelUsdzUrl":null,"modelGlbUrl":null,"price":null,"offer":null,"eventStartsAt":null,
     "artist":{"name":"Ana Ruiz","slug":"ana-ruiz","bio":null}}
    """

    static let menuDisplay = """
    {"id":"dsp_menu1","type":"menu_item","placement":"table","title":"Tuesday Birria Tower","description":"",
     "mediaUrl":null,"thumbnailUrl":"https://h.example/t.webp",
     "modelUsdzUrl":"https://h.example/api/storage/public-objects/m.usdz","modelGlbUrl":"https://h.example/m.glb",
     "price":"$14.00","offer":null,"eventStartsAt":null,"artist":null}
    """

    static let eventDisplay = """
    {"id":"dsp_event1","type":"event_teaser","placement":"poster","title":"Cumbia Thursdays","description":"Live band",
     "mediaUrl":null,"thumbnailUrl":null,"modelUsdzUrl":null,"modelGlbUrl":null,"price":null,"offer":null,
     "eventStartsAt":"2026-10-17T01:00:00Z","artist":null}
    """

    static let tableCard = """
    {"id":"tc1","name":"Table tent","referenceImageUrl":"https://h.example/card.png","physicalWidthCm":10.5}
    """

    static let scanResult = """
    {"venue":\(venueSummary),"spot":{"label":"Table 6","placement":"table"},
     "display":\(offerDisplay),
     "displays":[\(offerDisplay),\(artDisplay),\(menuDisplay),\(eventDisplay)],
     "tableCards":[\(tableCard)],"scanId":"ignored"}
    """

    static let scanResultNoDisplay = """
    {"venue":\(venueSummary),"spot":{"label":"Front window","placement":"window"},
     "display":null,"displays":[\(artDisplay)],"tableCards":[]}
    """

    static let publicVenue = """
    {"venue":\(venueSummary),"displays":[\(menuDisplay)],"tableCards":[\(tableCard)]}
    """

    static let claim = """
    {"confirmationCode":"BX-4821","offerTitle":"Free agua fresca","venueName":"Casa Marisol",
     "spotLabel":"Table 6","claimedAt":"2026-10-15T00:14:00.000Z","expiresAt":"2026-10-15T00:29:00.000Z",
     "status":"active"}
    """

    static let claimNoSpot = """
    {"confirmationCode":"BX-4822","offerTitle":"Free agua fresca","venueName":"Casa Marisol",
     "spotLabel":null,"claimedAt":"2026-10-15T00:14:00Z","expiresAt":"2026-10-15T00:29:00Z"}
    """

    static let nearby = """
    [{"slug":"la-gaviota","name":"La Gaviota Taquería","kind":"venue","neighborhood":"Little Havana",
      "distanceMeters":240,"liveDisplays":2,"featured":"3D special","latitude":25.7655,"longitude":-80.219},
     {"slug":"ana-ruiz","name":"Ana Ruiz","kind":"artist","neighborhood":"Little Havana",
      "distanceMeters":800,"liveDisplays":1,"featured":null,"latitude":25.76,"longitude":-80.22,"rank":3}]
    """

    static let artist = """
    {"slug":"ana-ruiz","name":"Ana Ruiz","bio":"Florals.","neighborhood":"Little Havana",
     "pieces":[{"displayId":"dsp_art1","title":"Night Bloom","description":"After dark.",
                "mediaUrl":null,"venueName":"Casa Marisol","venueSlug":"casa-marisol",
                "neighborhood":"Little Havana","likes":9}]}
    """
}
